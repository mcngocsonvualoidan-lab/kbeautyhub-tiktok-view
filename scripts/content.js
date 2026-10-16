/**
 * Kbeautyhub - TikTok View v1.9.4
 * Developed by Son Designer
 * Content script running in ISOLATED world
 * Automatically unblocks and plays TikTok videos (including TikTok Shop & restricted videos)
 * using direct stream extraction + TikWM resolver fallback, displaying rich shop & cart links.
 */
(function() {
  'use strict';

  console.log('[Kbeautyhub] Content script v1.9.4 loaded.');

  const videoDataMap = new Map();
  const resolvingSet = new Set();
  const shopNameCache = new Map();
  const sellerShopCache = new Map();
  let currentActiveVideoId = null;
  let overlayContainer = null;
  let drawerElement = null;
  let floatingHubBtn = null;
  let lastMountedStreamUrl = null;
  let lastMountedVideoId = null;

  // Master switch and activation state
  let isMasterEnabled = null; // null = pending check from storage
  let isUnlocked = true;
  let isBooted = false;

  // Real-time synchronization for Master Switch & Unlock status from popup or other tabs
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.kbeauty_master_enabled !== undefined) {
          const newEnabled = !!changes.kbeauty_master_enabled.newValue;
          console.log('[Kbeautyhub] Master switch storage changed:', newEnabled);
          setExtensionEnabled(newEnabled);
        }
        if (changes.kbeauty_is_unlocked !== undefined) {
          isUnlocked = !!changes.kbeauty_is_unlocked.newValue;
          applyExtensionState();
        }
      }
    });
  } catch (e) {}

  function setExtensionEnabled(enabled) {
    isMasterEnabled = !!enabled;
    if (isMasterEnabled) {
      if (!isBooted) {
        boot();
      } else {
        applyExtensionState();
        updateUI();
        updateFloatingHubPosition();
      }
    } else {
      tearDownExtension();
    }
  }

  function tearDownExtension() {
    isMasterEnabled = false;

    // 1. Completely remove all injected DOM elements
    const root = document.getElementById('kbeauty-root');
    if (root) root.remove();
    overlayContainer = null;
    floatingHubBtn = null;
    drawerElement = null;

    // 2. Remove unblocked custom player box and restore native TikTok video
    const unblockedBox = document.getElementById('kbeauty-unblocked-player-box');
    if (unblockedBox) {
      unblockedBox.remove();
      lastMountedStreamUrl = null;
      lastMountedVideoId = null;
      document.querySelectorAll('video').forEach(v => {
        v.style.display = '';
        if (v.paused) v.play().catch(() => {});
      });
    }

    // 3. Remove in-video cart badge
    document.getElementById('kbeauty-invideo-cart-badge')?.remove();

    console.log('[Kbeautyhub] Extension completely torn down (DORMANT MODE).');
  }

  function applyExtensionState() {
    if (!isMasterEnabled) {
      tearDownExtension();
      return;
    }

    if (!isUnlocked) {
      if (floatingHubBtn) {
        floatingHubBtn.style.display = 'flex';
        floatingHubBtn.style.borderColor = '#F59E0B';
        const labelEl = document.getElementById('kbeauty-hub-label');
        if (labelEl) labelEl.textContent = '🔒 Chưa kích hoạt (Nhập Pass)';
        const badgeEl = document.getElementById('kbeauty-hub-badge');
        if (badgeEl) badgeEl.style.display = 'none';
      }
      const unblockedBox = document.getElementById('kbeauty-unblocked-player-box');
      if (unblockedBox) unblockedBox.remove();
      return;
    }

    if (floatingHubBtn) {
      floatingHubBtn.style.display = 'flex';
    }
  }

  function sendDeviceHeartbeat(videoData) {
    if (!isMasterEnabled) return;
    try {
      chrome.runtime.sendMessage({
        action: 'DEVICE_HEARTBEAT',
        data: {
          currentWatching: videoData ? {
            videoId: videoData.videoId || getUrlVideoId() || '',
            author: videoData.author?.uniqueId || '',
            hasShopCart: !!videoData.hasShopCart,
            shopName: videoData.shopName || '',
            title: videoData.desc || '',
            url: window.location.href
          } : null,
          screen: `${window.screen.width}x${window.screen.height}`
        }
      }).catch(() => {});
    } catch (e) {}
  }

  // Load persistent real shop names from storage on startup
  try {
    chrome.storage.local.get('kbeauty_shop_names', (data) => {
      if (data && data.kbeauty_shop_names) {
        for (const [k, v] of Object.entries(data.kbeauty_shop_names)) {
          shopNameCache.set(k, v);
        }
      }
    });
  } catch (e) {}

  // Universal media URL extractor
  function extractMediaUrl(videoObj) {
    if (!videoObj) return '';

    function checkField(f) {
      if (!f) return '';
      if (typeof f === 'string' && f.startsWith('http')) return f;
      if (Array.isArray(f)) {
        for (const item of f) {
          const u = checkField(item);
          if (u) return u;
        }
      }
      if (typeof f === 'object') {
        const list = f.UrlList || f.urlList || f.url_list || f.URLList;
        if (Array.isArray(list) && list.length > 0) {
          for (const u of list) {
            if (typeof u === 'string' && u.startsWith('http')) return u;
          }
        }
        if (typeof f.main_url === 'string') return f.main_url;
        if (typeof f.url === 'string') return f.url;
      }
      return '';
    }

    let url = checkField(videoObj.playAddr) || checkField(videoObj.PlayAddr) || checkField(videoObj.play_addr);
    if (url) return url;

    const bitrates = videoObj.bitrateInfo || videoObj.BitrateInfo || videoObj.bitrate_info;
    if (Array.isArray(bitrates)) {
      for (const b of bitrates) {
        url = checkField(b.PlayAddr || b.playAddr || b.play_addr);
        if (url) return url;
      }
    }

    url = checkField(videoObj.downloadAddr) || checkField(videoObj.DownloadAddr) || checkField(videoObj.download_addr);
    if (url) return url;

    url = checkField(videoObj.playAddrH265) || checkField(videoObj.playAddrBytevc1) || checkField(videoObj.PlayAddrH265);
    if (url) return url;

    return '';
  }

  // Recursive extractor for TikTok Shop anchors (handles nested stringified JSON & 64-bit IDs)
  function extractProductsFromItem(item) {
    const products = [];
    if (!item) return products;

    function handleAnchor(anchor) {
      if (!anchor) return;

      if (typeof anchor.extra === 'string') {
        const raw = anchor.extra;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const sub of parsed) {
              handleAnchor(sub);
            }
            return;
          }
        } catch (e) {}

        // Regex extraction on raw extra string (preserves 64-bit integer precision for IDs)
        const pMatch = raw.match(/product_id\\*":\s*\\*"?(\d+)/);
        const sMatch = raw.match(/seller_id\\*":\s*\\*"?(\d+)/);
        const seoMatch = raw.match(/seo_url\\*":\s*\\*"([^\\"]+)/);
        const titleMatch = raw.match(/title\\*":\s*\\*"([^\\"]+)/);
        const coverMatch = raw.match(/cover_url\\*":\s*\\*"([^\\"]+)/) || raw.match(/cover\\*":\s*\\*"([^\\"]+)/);
        const priceMatch = raw.match(/format_price\\*":\s*\\*"([^\\"]+)/);
        const shopMatch = raw.match(/(?:shop_name|seller_name|shopName|sellerName|store_name|merchant_name|brand_name|seller_title|shop_title)\\*":\s*\\*"([^\\"]+)/i);

        let extractedShopName = '';
        if (shopMatch) {
          try {
            extractedShopName = JSON.parse(`"${shopMatch[1]}"`);
          } catch (e) {
            extractedShopName = shopMatch[1];
          }
        }

        if (pMatch || sMatch || anchor.component_key === 'anchor_shop' || anchor.type === 33) {
          const productId = pMatch ? pMatch[1] : (anchor.id ? String(anchor.id) : '');
          const sellerId = sMatch ? sMatch[1] : '';
          const title = titleMatch ? titleMatch[1] : (anchor.keyword || anchor.name || 'Sản phẩm TikTok Shop');
          let cover = coverMatch ? coverMatch[1].replace(/\\/g, '') : '';
          const seoUrl = seoMatch ? seoMatch[1].replace(/\\/g, '') : (productId ? `https://shop.tiktok.com/pdp/${productId}` : '');

          let knownShop = extractedShopName || '';
          if (!knownShop && productId && shopNameCache.has(productId)) {
            knownShop = shopNameCache.get(productId);
          } else if (!knownShop && sellerId && sellerShopCache.has(sellerId)) {
            knownShop = sellerShopCache.get(sellerId);
          }

          const authorUniqueId = item.author?.uniqueId || '';
          const authorNickname = item.author?.nickname || '';
          const creatorShowcaseName = authorNickname ? `${authorNickname} (@${authorUniqueId})` : (authorUniqueId ? `Shop của @${authorUniqueId}` : 'TikTok Shop');
          const finalShopName = knownShop || creatorShowcaseName;

          const shopUrl = knownShop
            ? `https://www.tiktok.com/search?q=${encodeURIComponent(knownShop)}`
            : (authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : (sellerId ? `https://shop.tiktok.com/seller/${sellerId}` : (seoUrl || 'https://shop.tiktok.com')));

          const prodObj = {
            productId,
            sellerId,
            title,
            price: priceMatch ? priceMatch[1] : 'Xem trên Shop',
            image: cover || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png',
            webUrl: seoUrl || (productId ? `https://shop.tiktok.com/pdp/${productId}` : 'https://shop.tiktok.com'),
            shopUrl: shopUrl,
            shopName: finalShopName,
            isRealShop: !!knownShop,
            source: 'tiktok_shop'
          };
          products.push(prodObj);

          if (productId && !knownShop) {
            resolveRealShopName(prodObj, item);
          }
          return;
        }
      }

      // Check standard and brand/showcase anchor formats
      const compKey = (anchor.component_key || '').toLowerCase();
      const isShopLike = compKey.includes('shop') || compKey.includes('ecom') || compKey.includes('product') || compKey.includes('brand') || compKey.includes('cart') || anchor.type === 33 || anchor.type === 6 || anchor.type === 40 || anchor.type === 24 || anchor.type === 28 || anchor.type === 54 || !!anchor.keyword || !!anchor.name;
      if (isShopLike) {
        const pId = anchor.id ? String(anchor.id) : (anchor.product_id ? String(anchor.product_id) : '');
        const title = anchor.keyword || anchor.name || anchor.title || 'Sản phẩm TikTok Shop';
        const authorUniqueId = item.author?.uniqueId || '';
        const authorNickname = item.author?.nickname || '';
        const creatorShowcaseName = authorNickname ? `${authorNickname} (@${authorUniqueId})` : (authorUniqueId ? `Shop của @${authorUniqueId}` : 'TikTok Shop');
        const shopDisplayName = (anchor.keyword || creatorShowcaseName);

        const prodObj = {
          productId: pId,
          sellerId: '',
          title: title,
          price: 'Xem trên Shop',
          image: anchor.thumbnail?.url_list?.[0] || anchor.icon?.url_list?.[0] || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png',
          webUrl: pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : (authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : 'https://shop.tiktok.com'),
          shopUrl: authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://www.tiktok.com'),
          shopName: shopDisplayName,
          isRealShop: !!anchor.keyword,
          source: 'tiktok_shop'
        };
        products.push(prodObj);
        if (pId) {
          resolveRealShopName(prodObj, item);
        }
      }
    }

    if (Array.isArray(item.anchors)) {
      for (const a of item.anchors) {
        handleAnchor(a);
      }
    }

    if (Array.isArray(item.products)) {
      for (const p of item.products) {
        const pId = String(p.id || p.product_id || '');
        const sId = String(p.seller_id || p.shop_id || '');
        const realShopName = p.shop_name || p.seller_name || '';
        const authorName = item.author?.uniqueId || item.author?.nickname || '';
        const shopUrl = realShopName 
          ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
          : (authorName ? `https://www.tiktok.com/@${authorName}` : (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://www.tiktok.com'));

        const prodObj = {
          productId: pId,
          sellerId: sId,
          title: p.title || p.name || 'Sản phẩm TikTok Shop',
          price: p.price || p.format_price || 'Xem trên Shop',
          image: p.cover || p.image || '',
          webUrl: pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://shop.tiktok.com',
          shopUrl,
          shopName: realShopName || (authorName ? `Shop của @${authorName}` : 'TikTok Shop'),
          isRealShop: !!realShopName,
          source: 'tiktok_shop'
        };
        products.push(prodObj);
        if (!realShopName && pId) {
          resolveRealShopName(prodObj, item);
        }
      }
    }

    return products;
  }

  function resolveRealShopName(prod, parentItem) {
    if (!prod || !prod.productId || prod.isRealShop) return;

    if (shopNameCache.has(prod.productId)) {
      const sName = shopNameCache.get(prod.productId);
      prod.shopName = sName;
      prod.isRealShop = true;
      prod.shopUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(sName)}`;
      updateShopDOM(prod);
      return;
    }

    chrome.runtime.sendMessage({ action: 'RESOLVE_PDP_SHOP_INFO', productId: prod.productId }, (res) => {
      if (res && res.success && res.shopName) {
        prod.shopName = res.shopName;
        prod.isRealShop = true;
        if (res.sellerId && !prod.sellerId) prod.sellerId = res.sellerId;
        prod.shopUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(res.shopName)}`;

        shopNameCache.set(prod.productId, res.shopName);
        if (prod.sellerId) sellerShopCache.set(prod.sellerId, res.shopName);

        try {
          chrome.storage.local.get('kbeauty_shop_names', (data) => {
            const names = data.kbeauty_shop_names || {};
            names[prod.productId] = res.shopName;
            if (prod.sellerId) names[prod.sellerId] = res.shopName;
            chrome.storage.local.set({ 'kbeauty_shop_names': names });
          });
        } catch (e) {}

        if (parentItem && parentItem.videoId) {
          const stored = videoDataMap.get(parentItem.videoId);
          if (stored) {
            stored.shopName = res.shopName;
            stored.shopUrl = prod.shopUrl;
            saveToHistory(stored);
          }
        }

        updateShopDOM(prod);
      }
    });
  }

  function updateShopDOM(prod) {
    if (!prod) return;
    const drawerBody = document.getElementById('kbeauty-drawer-body');
    if (!drawerBody) return;

    const cards = drawerBody.querySelectorAll(`.kbeauty-product-card[data-pid="${prod.productId}"], .kbeauty-product-card`);
    cards.forEach(card => {
      if (card.getAttribute('data-pid') === prod.productId || (!card.getAttribute('data-pid') && cards.length === 1)) {
        const nameEl = card.querySelector('.kbeauty-shop-name-text');
        if (nameEl) nameEl.textContent = prod.shopName;
        const inputEl = card.querySelector('.kbeauty-shop-link-input');
        if (inputEl) inputEl.value = prod.shopUrl;
        const btnLink = card.querySelector('.kbeauty-shop-link-btn');
        if (btnLink) btnLink.href = prod.shopUrl;
        const copyBtn = card.querySelector('.kbeauty-shop-copy-btn');
        if (copyBtn) copyBtn.setAttribute('data-copy', prod.shopUrl);
        const verifiedName = card.querySelector('.verified-shop-name');
        if (verifiedName) verifiedName.innerHTML = `<span style="color:#FFFFFF; font-weight:800;">${escapeHtml(prod.shopName)}</span>`;
        const verifiedBtn = card.querySelector('.verified-shop-btn');
        if (verifiedBtn) verifiedBtn.href = prod.shopUrl;
      }
    });
  }

  function parseShopAnchor(anchor) {
    const list = extractProductsFromItem({ anchors: [anchor] });
    return list.length > 0 ? list[0] : null;
  }

  async function saveToHistory(item) {
    if (!item || !item.videoId) return;
    try {
      const store = await chrome.storage.local.get(['kbeauty_history', 'kbeauty_device_id', 'kbeauty_user_role']);
      const deviceId = store.kbeauty_device_id || 'UNKNOWN';
      const userRole = store.kbeauty_user_role || 'guest';
      let history = store.kbeauty_history || [];
      history = history.filter(h => h.videoId !== item.videoId);
      
      const historyEntry = {
        ...item,
        deviceId: deviceId,
        userRole: userRole,
        savedAt: Date.now()
      };
      
      history.unshift(historyEntry);
      if (history.length > 200) history = history.slice(0, 200);
      await chrome.storage.local.set({ 'kbeauty_history': history });

      // Notify background service worker for cloud synchronization
      chrome.runtime.sendMessage({ action: 'SYNC_HISTORY_ENTRY', entry: historyEntry }).catch(() => {});
    } catch (e) {}
  }

  // Listen to batch data dispatched from interceptor (MAIN world)
  window.addEventListener('KBEAUTY_TIKTOK_DATA_EVENT', (event) => {
    if (!isMasterEnabled) return;
    try {
      const { type, data } = event.detail || {};
      if (type === 'SPA_NAVIGATE') {
        setTimeout(() => {
          updateUI();
          updateFloatingHubPosition();
        }, 80);
        return;
      }

      if (type === 'VIDEOS_BATCH' && Array.isArray(data)) {
        for (const item of data) {
          if (item && item.videoId) {
            const existing = videoDataMap.get(item.videoId) || {};
            const combinedProducts = (item.products && item.products.length > 0) 
              ? item.products 
              : (existing.products || []);
            const updated = {
              ...existing,
              ...item,
              products: combinedProducts,
              hasShopCart: item.hasShopCart || (combinedProducts.length > 0) || existing.hasShopCart,
              playAddr: item.playAddr || existing.playAddr
            };
            videoDataMap.set(item.videoId, updated);
            saveToHistory(updated);
          }
        }
        updateUI();
      }
    } catch (e) {}
  });

  // Parse directly from __UNIVERSAL_DATA_FOR_REHYDRATION__ in DOM
  function parseRehydrationData(targetVid) {
    try {
      const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!script || !script.textContent) return null;

      const parsed = JSON.parse(script.textContent);
      const defaultScope = parsed['__DEFAULT_SCOPE__'] || parsed;
      const detail = defaultScope['webapp.video-detail'];
      const item = detail?.itemInfo?.itemStruct;

      if (item && item.id) {
        const videoId = String(item.id);
        if (targetVid && String(targetVid) !== videoId) {
          return null;
        }
        const playAddr = extractMediaUrl(item.video);

        const products = extractProductsFromItem(item);

        const videoData = {
          videoId,
          desc: item.desc || '',
          author: {
            id: item.author?.id || item.author?.uniqueId || '',
            uniqueId: item.author?.uniqueId || item.author?.nickname || 'creator',
            nickname: item.author?.nickname || '',
            avatar: item.author?.avatarThumb || item.author?.avatarMedium || ''
          },
          playAddr,
          cover: item.video?.cover || '',
          products,
          sellerId: products.length > 0 ? products[0].sellerId : '',
          shopUrl: products.length > 0 ? products[0].shopUrl : '',
          shopName: products.length > 0 ? products[0].shopName : '',
          hasShopCart: products.length > 0 || !!item.is_ecommerce || (Array.isArray(item.anchors) && item.anchors.length > 0) || !!findBlockerElement(),
          capturedAt: Date.now()
        };

        videoDataMap.set(videoId, videoData);
        saveToHistory(videoData);

        for (const p of products) {
          if (p.productId && !p.isRealShop) {
            resolveRealShopName(p, videoData);
          }
        }
        return videoData;
      }
    } catch (err) {}
    return null;
  }

  // Resolve video stream via Background Service Worker (immune to page CSP)
  async function resolveStreamViaTikWM(videoId) {
    if (!videoId) return null;
    if (resolvingSet.has(videoId)) {
      return videoDataMap.get(videoId) || null;
    }
    resolvingSet.add(videoId);

    try {
      console.log('[Kbeautyhub] Resolving stream via Background SW for video:', videoId);
      let res = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'RESOLVE_TIKWM', videoId }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[Kbeautyhub] Background message error:', chrome.runtime.lastError);
              resolve(null);
            } else {
              resolve(response);
            }
          });
        } catch (e) {
          resolve(null);
        }
      });

      // Fallback: direct fetch if background SW didn't respond
      if (!res || !res.success || !res.data) {
        try {
          console.log('[Kbeautyhub] Trying direct fetch fallback for TikWM:', videoId);
          const fullUrl = `https://www.tiktok.com/@user/video/${videoId}`;
          const directFetch = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(fullUrl)}`);
          if (directFetch.ok) {
            const dj = await directFetch.json();
            if (dj && dj.code === 0) {
              res = { success: true, data: dj };
            }
          }
        } catch (dfErr) {
          console.warn('[Kbeautyhub] Direct fetch error:', dfErr);
        }
      }

      if (res && res.success && res.data && res.data.code === 0 && res.data.data) {
        const d = res.data.data;
        const streamUrl = d.play || d.wmplay || '';
        let existing = videoDataMap.get(videoId) || {};
        let resolvedProducts = existing.products || [];
        if (Array.isArray(d.anchors) && resolvedProducts.length === 0) {
          for (const a of d.anchors) {
            const p = parseShopAnchor(a);
            if (p) resolvedProducts.push(p);
          }
        }
        const hasShop = resolvedProducts.length > 0 || 
                        !!d.anchors_extras || 
                        (existing.hasShopCart && existing.videoId === videoId);

        const updated = {
          ...existing,
          videoId,
          desc: d.title || existing.desc || '',
          author: {
            id: d.author?.id || existing.author?.id || '',
            uniqueId: d.author?.unique_id || existing.author?.uniqueId || 'creator',
            nickname: d.author?.nickname || existing.author?.nickname || '',
            avatar: d.author?.avatar || existing.author?.avatar || ''
          },
          playAddr: streamUrl,
          hasShopCart: hasShop,
          products: resolvedProducts,
          sellerId: resolvedProducts.length > 0 ? resolvedProducts[0].sellerId : (existing.sellerId || ''),
          shopUrl: resolvedProducts.length > 0 ? resolvedProducts[0].shopUrl : (existing.shopUrl || ''),
          shopName: resolvedProducts.length > 0 ? resolvedProducts[0].shopName : (existing.shopName || ''),
          capturedAt: Date.now()
        };
        videoDataMap.set(videoId, updated);
        saveToHistory(updated);

        // Resolve real shop name for newly discovered products
        for (const p of resolvedProducts) {
          if (p.productId && !p.isRealShop) {
            resolveRealShopName(p, updated);
          }
        }
        unblockAndPlay(streamUrl);
        return updated;
      } else {
        resolvingSet.delete(videoId);
      }
    } catch (err) {
      resolvingSet.delete(videoId);
      console.warn('[Kbeautyhub] TikWM resolve error:', err);
    }
    return null;
  }

  function getUrlVideoId() {
    // 1. Direct video URL match (e.g. /@user/video/123456... or /video/123456...)
    const match = window.location.pathname.match(/\/video\/(\d+)/);
    if (match) return match[1];

    // If on a creator/shop profile page (/@username without /video/), user is on profile grid!
    // NEVER unblock onto the profile grid page!
    if (window.location.pathname.startsWith('/@')) {
      return null;
    }

    // 2. Feed mode: Find video element currently centered or playing in viewport (ONLY in feed like /, /foryou)
    const videos = document.querySelectorAll('video');
    let bestVideo = null;
    let maxVisibleHeight = 0;
    const vh = window.innerHeight;

    for (const v of videos) {
      if (v.id === 'kbeauty-main-video' || v.id === 'kbeauty-drawer-video') continue;
      const rect = v.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      if (visibleHeight > maxVisibleHeight && visibleHeight > 200) {
        maxVisibleHeight = visibleHeight;
        bestVideo = v;
      }
    }

    if (bestVideo) {
      let p = bestVideo.parentElement;
      for (let i = 0; i < 8 && p; i++) {
        const link = p.querySelector('a[href*="/video/"]');
        if (link && link.href) {
          const m = link.href.match(/\/video\/(\d+)/);
          if (m) return m[1];
        }
        p = p.parentElement;
      }
    }

    return null;
  }

  function getProfileUsername() {
    const match = window.location.pathname.match(/^\/@([^/?#]+)/);
    return match ? match[1] : null;
  }

  // Robust leaf-node finder for the blocker toast (never matches parent containers)
  function findBlockerElement() {
    const all = document.querySelectorAll('div, p, span, h1, h2, h3');
    for (const el of all) {
      if (el.children.length <= 1) {
        const txt = (el.textContent || '').trim();
        if (txt.includes('Xem video TikTok Shop') ||
            txt.includes('Xem video trên ứng dụng') ||
            txt.includes('Xem video trong ứng dụng') ||
            txt.includes('Watch TikTok Shop') ||
            txt.includes('Watch in the TikTok app') ||
            txt.includes('Tải ứng dụng để xem video') ||
            txt.includes('không thể phát trên trình duyệt')) {
          return el;
        }
      }
    }
    return null;
  }

  // Real-time DOM Anchor Scanner (detects anchor chips like 'Rosaleen' or TikTok Shop banners directly on screen)
  function findDOMShopAnchor() {
    // 1. Blocker element
    if (findBlockerElement()) return { isShop: true, title: 'TikTok Shop' };

    // 2. Yellow Shop Banner at bottom (e.g. 'GIỎ HÀNG TIKTOK', 'Video có gắn giỏ hàng')
    const elements = document.querySelectorAll('div, p, span, a, button');
    for (const el of elements) {
      const text = (el.textContent || '').trim();
      if (text.includes('GIỎ HÀNG TIKTOK') || text.includes('Video có gắn giỏ hàng')) {
        return { isShop: true, title: 'TikTok Shop' };
      }
    }

    // 3. Anchor tags / chips on video stage (e.g. "Rosaleen", anchor chips with shopping bag icon)
    const anchorElements = document.querySelectorAll('[data-e2e*="anchor"], [class*="Anchor"], [class*="anchor"], a[href*="/tag/"], a[href*="/product/"], a[href*="/pdp/"], a[href*="shop.tiktok.com"]');
    for (const el of anchorElements) {
      const text = (el.textContent || '').trim();
      if (text && text.length > 1 && text.length < 50 && 
          !text.includes('Follow') && !text.includes('Thích') && 
          !text.includes('Bình luận') && !text.includes('Chia sẻ') &&
          !text.includes('Đăng nhập') && !text.includes('Kbeautyhub')) {
        return { isShop: true, title: text };
      }
    }

    return null;
  }

  // Single Audio Stream Enforcement: prevent native videos from playing sound while unblocked player is active
  document.addEventListener('play', (e) => {
    if (document.getElementById('kbeauty-unblocked-player-box')) {
      const target = e.target;
      if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO') && target.id !== 'kbeauty-main-video' && target.id !== 'kbeauty-drawer-video') {
        try {
          target.pause();
          target.muted = true;
          target.volume = 0;
        } catch (err) {}
      }
    }
  }, true);

  // Check if an element belongs to the right-hand sidebar (comments, reactions, author info)
  function isInsideRightSidebar(el) {
    if (!el) return false;

    // Position check: in TikTok PC layout, the right sidebar starts around (window.innerWidth - 560px)
    const sidebarStartX = Math.max(window.innerWidth * 0.58, window.innerWidth - 560);
    const r = el.getBoundingClientRect();
    if (r.left < sidebarStartX) return false;

    const sidebar = el.closest('[data-e2e="comment-list"]') || 
                    el.closest('div[class*="Comment"]') ||
                    el.closest('div[class*="RightContainer"]') ||
                    el.closest('div[class*="DivSidebarContainer"]') ||
                    el.closest('div[class*="TabContainer"]') ||
                    el.closest('div[class*="DivInfoContainer"]') ||
                    el.closest('div[class*="Description"]') ||
                    el.closest('div[class*="BottomCommentContainer"]');
    if (sidebar) return true;

    if (r.left >= sidebarStartX && r.width < 620) {
      return true;
    }
    return false;
  }

  // Calculate the visible area of an element currently in the viewport
  function getVisibleViewportScore(el, minLeft, maxRight) {
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const vTop = Math.max(0, r.top);
    const vBottom = Math.min(vh, r.bottom);
    const vLeft = Math.max(minLeft, r.left);
    const vRight = Math.min(maxRight, r.right);
    if (vBottom <= vTop || vRight <= vLeft) return 0;
    return (vBottom - vTop) * (vRight - vLeft);
  }

  // Ultra-robust finder for the main visible video stage on TikTok PC
  // Viewport-aware: ALWAYS targets the active video visible in viewport, never off-screen scrolled videos
  function findMainVideoStage(targetVid) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sidebarStartX = Math.max(vw * 0.58, vw - 560);
    const closeBtn = document.querySelector('[data-e2e="browse-close"]');
    const isModal = Boolean(closeBtn);

    // MODE 1: MODAL VIEW (Popup from shop profile / search)
    if (isModal) {
      // 1. Ancestor of Close Button ([data-e2e="browse-close"]) that spans the left stage
      let p = closeBtn.parentElement;
      while (p && p !== document.body && p.id !== 'root' && p.id !== '__next') {
        if (isInsideRightSidebar(p)) break;
        const r = p.getBoundingClientRect();
        if (r.left < 140 && r.top < 140 && r.width >= 400 && r.height >= 400 && r.width < vw - 250) {
          return p;
        }
        p = p.parentElement;
      }

      // 2. Primary left-stage modal containers
      const modalLeftSelectors = [
        '[data-e2e="browse-video"]',
        '[data-e2e="browse-video-container"]',
        'div[class*="DivBrowseModeContainer"]',
        'div[class*="DivVideoContainer"]',
        'div[class*="DivVideoWrapper"]',
        'div[class*="DivBasicPlayerWrapper"]',
        '[data-e2e="video-container"]',
        '[data-e2e="video-player-container"]'
      ];

      for (const sel of modalLeftSelectors) {
        const candidates = document.querySelectorAll(sel);
        for (const el of candidates) {
          if (isInsideRightSidebar(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.left < 140 && r.top < 140 && r.width >= 400 && r.height >= 400 && r.width < vw - 250) {
            return el;
          }
        }
      }

      // 3. Fallback: Any div on the left stage spanning full height
      const divs = document.querySelectorAll('div, section');
      let bestModal = null;
      let maxArea = 0;
      for (const d of divs) {
        if (d.id === 'kbeauty-root' || d.id === 'root' || d.id === '__next' || d === document.body) continue;
        if (d.closest('#kbeauty-root') || d.closest('#kbeauty-drawer')) continue;
        if (isInsideRightSidebar(d)) continue;
        const r = d.getBoundingClientRect();
        if (r.left < 140 && r.top < 140 && r.width >= 400 && r.height >= 400 && r.width < vw - 250) {
          const area = r.width * r.height;
          if (area > maxArea) {
            maxArea = area;
            bestModal = d;
          }
        }
      }
      if (bestModal) return bestModal;
    }

    // MODE 2: DIRECT PAGE / FEED VIEW (No modal close button, e.g. standalone video URL or feed)
    // Left nav bar is typically at x: 0 to ~240px
    const leftNav = document.querySelector('[data-e2e="nav-bar"], [data-e2e="side-nav"], nav, aside, div[class*="SideNav"], div[class*="DivSideNavContainer"]');
    const leftNavRight = leftNav ? Math.min(leftNav.getBoundingClientRect().right, 300) : 0;
    const minVideoLeft = Math.max(0, leftNavRight - 20);
    const maxVideoRight = sidebarStartX + 40;

    const currentVid = targetVid || getUrlVideoId();

    // 1. Precise Match: Look for explicit video card belonging to currentVid in DOM
    if (currentVid) {
      const vidLink = document.querySelector(`a[href*="/video/${currentVid}"]`);
      if (vidLink) {
        const itemContainer = vidLink.closest('[data-e2e="recommend-list-item-container"], div[class*="DivItemContainer"], div[class*="FeedVideo"], [data-e2e="feed-video"]');
        if (itemContainer) {
          const innerWrapper = itemContainer.querySelector('div[class*="DivVideoWrapper"], div[class*="DivPlayerContainer"], div[class*="DivBasicPlayerWrapper"], [data-e2e="video-container"], [data-e2e="feed-video"]');
          if (innerWrapper && !isInsideRightSidebar(innerWrapper)) {
            const ir = innerWrapper.getBoundingClientRect();
            if (ir.width >= 240 && ir.height >= 260) {
              return innerWrapper;
            }
          }
          return itemContainer;
        }
      }
    }

    // 2. Viewport Overlap Match: Select candidate with GREATEST VISIBLE OVERLAP in active screen
    const pageVideoSelectors = [
      '[data-e2e="feed-video"]',
      'div[class*="DivVideoWrapper"]',
      'div[class*="DivBasicPlayerWrapper"]',
      'div[class*="DivPlayerContainer"]',
      '[data-e2e="video-player-container"]',
      '[data-e2e="video-container"]',
      'div[class*="DivVideoContainer"]',
      '[data-e2e="recommend-list-item-container"]'
    ];

    let bestCandidate = null;
    let maxVisibleScore = 0;

    for (const sel of pageVideoSelectors) {
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        if (isInsideRightSidebar(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= 240 && r.height >= 260 && r.left >= minVideoLeft && r.left < sidebarStartX - 100) {
          const score = getVisibleViewportScore(el, minVideoLeft, maxVideoRight);
          if (score > maxVisibleScore) {
            maxVisibleScore = score;
            bestCandidate = el;
          }
        }
      }
    }

    if (bestCandidate && maxVisibleScore > 40000) {
      return bestCandidate;
    }

    // 3. Fallback: Search native videos visible in viewport
    const nativeVideos = document.querySelectorAll('video:not(#kbeauty-main-video):not(#kbeauty-drawer-video)');
    let bestNativeParent = null;
    let maxNativeScore = 0;
    for (const nv of nativeVideos) {
      if (isInsideRightSidebar(nv)) continue;
      const score = getVisibleViewportScore(nv, minVideoLeft, maxVideoRight);
      if (score > maxNativeScore) {
        maxNativeScore = score;
        let p = nv.parentElement;
        while (p && p !== document.body && p.id !== 'root' && p.id !== '__next' && !isInsideRightSidebar(p)) {
          const pr = p.getBoundingClientRect();
          if (pr.width >= 240 && pr.height >= 260) {
            bestNativeParent = p;
            break;
          }
          p = p.parentElement;
        }
      }
    }
    if (bestNativeParent) return bestNativeParent;

    return bestCandidate;
  }

  // Check if current video is ACTUALLY blocked by TikTok Shop
  function isVideoBlocked(videoData) {
    if (!videoData) return false;

    // 1. Blocker element explicitly found in DOM (e.g. "Xem video TikTok Shop trong ứng dụng TikTok")
    if (findBlockerElement()) return true;

    // 2. Check if user is in a Modal popup (opened from a shop profile grid or search)
    const isModal = Boolean(document.querySelector('[data-e2e="browse-close"]'));

    // In normal Feed / Direct URL scroll: NEVER unblock because TikTok PC plays natively!
    if (!isModal) {
      return false;
    }

    // 3. In Modal view (shop profile modal):
    // If native video is ALREADY PLAYING, never touch it!
    const nativeVid = document.querySelector('video:not(#kbeauty-main-video):not(#kbeauty-drawer-video)');
    if (nativeVid && !nativeVid.paused && nativeVid.currentTime > 0.3 && !nativeVid.error) {
      return false;
    }

    // If in modal and has shop cart and native video is not playing / stalled / errored
    if (videoData.hasShopCart) {
      if (!nativeVid || nativeVid.paused || nativeVid.error || nativeVid.readyState < 2) {
        return true;
      }
    }

    return false;
  }

  // UNBLOCK & INJECT HTML5 PLAYER
  function unblockAndPlay(streamUrl, force = false) {
    if (!streamUrl) return;

    const currentVid = getUrlVideoId();
    if (!currentVid) {
      // Clean up player box if user navigated away from video to profile grid
      const staleBox = document.getElementById('kbeauty-unblocked-player-box');
      if (staleBox) staleBox.remove();
      lastMountedStreamUrl = null;
      lastMountedVideoId = null;
      return;
    }

    if (!force && lastMountedVideoId !== currentVid) {
      const staleBox = document.getElementById('kbeauty-unblocked-player-box');
      if (staleBox) staleBox.remove();
      lastMountedStreamUrl = null;
    }

    if (!force && lastMountedStreamUrl === streamUrl && document.getElementById('kbeauty-unblocked-player-box')) {
      const vidData = videoDataMap.get(currentVid) || parseRehydrationData();
      updateInVideoCartBadge(vidData);
      return;
    }

    // 1. Hide all blocker toasts and tooltips safely (leaf node only, NEVER touch parents)
    document.querySelectorAll('div, p, span').forEach(el => {
      if ((el.textContent || '').includes('Xem video TikTok Shop')) {
        el.style.display = 'none';
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    });

    // 2. Find video stage container
    const container = findMainVideoStage();

    if (!container || container === document.body || container.id === 'root' || container.id === '__next') {
      console.warn('[Kbeautyhub] Video stage container not ready yet for vid:', currentVid, 'scheduling retry');
      setTimeout(() => {
        if (!document.getElementById('kbeauty-unblocked-player-box') && getUrlVideoId() === currentVid) {
          unblockAndPlay(streamUrl, force);
        }
      }, 300);
      return;
    }

    console.log('[Kbeautyhub] Mounting unblocked HTML5 player on left stage for vid:', currentVid, 'container:', container);
    lastMountedStreamUrl = streamUrl;
    lastMountedVideoId = currentVid;

    // Use full left-stage container directly to guarantee perfect centering
    let targetStage = container;

    // Pause and mute other videos on page to prevent sound overlap (do not hide globally)
    document.querySelectorAll('video, audio').forEach(v => {
      if (v.id !== 'kbeauty-main-video' && v.id !== 'kbeauty-drawer-video') {
        try {
          v.pause();
          v.muted = true;
          v.volume = 0;
        } catch (e) {}
      }
    });

    // Ensure targetStage has relative positioning and adequate height
    const compPos = window.getComputedStyle(targetStage).position;
    if (compPos === 'static') {
      targetStage.style.position = 'relative';
    }
    const sRect = targetStage.getBoundingClientRect();
    if (sRect.height < 320) {
      targetStage.style.minHeight = '520px';
    }

    const isModal = Boolean(document.querySelector('[data-e2e="browse-close"]'));

    // Elevate Close button (X) and search bar on Modal so user can navigate easily
    const closeBtn = document.querySelector('[data-e2e="browse-close"]');
    if (closeBtn) {
      closeBtn.style.zIndex = '10000';
      let cp = closeBtn.parentElement;
      while (cp && cp !== document.body && cp.id !== 'root' && cp.id !== '__next') {
        if (window.getComputedStyle(cp).zIndex !== 'auto') {
          cp.style.zIndex = '10000';
        }
        cp = cp.parentElement;
      }
    }
    const searchForm = document.querySelector('form[action*="/search"], input[type="search"]');
    if (searchForm) {
      const sp = searchForm.closest('div');
      if (sp) sp.style.zIndex = '10000';
    }

    // Remove any previous instance of player box
    const existing = document.getElementById('kbeauty-unblocked-player-box');
    if (existing) existing.remove();

    const playerBox = document.createElement('div');
    playerBox.id = 'kbeauty-unblocked-player-box';
    playerBox.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000000;
      overflow: hidden;
      z-index: ${isModal ? 9999 : 99};
      pointer-events: auto;
      border-radius: ${isModal ? '0' : '12px'};
    `;

    playerBox.innerHTML = `
      <video 
        id="kbeauty-main-video" 
        src="${streamUrl}" 
        controls 
        autoplay 
        loop 
        playsinline
        style="width: 100%; height: 100%; max-height: 100%; max-width: ${isModal ? 'calc(100vh * 9 / 16)' : '100%'}; aspect-ratio: 9/16; object-fit: contain; background: #000000; display: block; margin: 0 auto; border-radius: ${isModal ? '6px' : '10px'};"
      ></video>
    `;

    // Only hide native video directly inside targetStage
    targetStage.querySelectorAll('video:not(#kbeauty-main-video)').forEach(el => {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
    });

    targetStage.appendChild(playerBox);

    function silenceNativeVideos() {
      if (!document.getElementById('kbeauty-unblocked-player-box')) return;
      document.querySelectorAll('video, audio').forEach(v => {
        if (v.id !== 'kbeauty-main-video' && v.id !== 'kbeauty-drawer-video') {
          try {
            v.pause();
            v.muted = true;
            v.volume = 0;
          } catch (e) {}
        }
      });
    }

    silenceNativeVideos();

    const vid = playerBox.querySelector('video');
    if (vid) {
      vid.addEventListener('play', silenceNativeVideos);
      vid.addEventListener('playing', silenceNativeVideos);
      vid.addEventListener('pause', silenceNativeVideos);
      vid.addEventListener('timeupdate', () => {
        document.querySelectorAll('video').forEach(v => {
          if (v.id !== 'kbeauty-main-video' && v.id !== 'kbeauty-drawer-video' && !v.paused) {
            try { v.pause(); v.muted = true; v.volume = 0; } catch (e) {}
          }
        });
      });

      const p = vid.play();
      if (p !== undefined) {
        p.catch(() => {
          vid.muted = true;
          vid.play().catch(() => {});
        });
      }
    }

    const vidData = videoDataMap.get(currentVid) || parseRehydrationData();
    updateInVideoCartBadge(vidData);
  }

  // In-Video Mobile-Style Cart Badge (attached to video player stage)
  function updateInVideoCartBadge(videoData) {
    const currentVid = getUrlVideoId();
    if (!currentVid || !videoData) {
      document.getElementById('kbeauty-invideo-cart-badge')?.remove();
      return;
    }

    const hasShop = videoData.hasShopCart || (videoData.products && videoData.products.length > 0) || !!findBlockerElement();
    if (!hasShop) {
      document.getElementById('kbeauty-invideo-cart-badge')?.remove();
      return;
    }

    // Target player container
    const playerBox = document.getElementById('kbeauty-unblocked-player-box');
    const container = playerBox || 
                      document.querySelector('[data-e2e="browse-video"]') ||
                      document.querySelector('div[class*="DivVideoContainer"]') ||
                      document.querySelector('div[class*="DivVideoWrapper"]') ||
                      document.querySelector('div[class*="PlayerContainer"]');

    if (!container) return;

    // Ensure relative/absolute positioning
    const compPos = window.getComputedStyle(container).position;
    if (compPos === 'static') {
      container.style.position = 'relative';
    }

    let badge = document.getElementById('kbeauty-invideo-cart-badge');
    if (!badge || badge.parentElement !== container) {
      if (badge) badge.remove();
      badge = document.createElement('div');
      badge.id = 'kbeauty-invideo-cart-badge';
      badge.className = 'kbeauty-mobile-cart-badge';
      container.appendChild(badge);
    }

    // Check if dismissed for this video
    if (badge.getAttribute('data-dismissed-vid') === currentVid) {
      badge.style.display = 'none';
      return;
    } else {
      badge.style.display = 'flex';
    }

    const prods = videoData.products || [];
    const firstProd = prods.length > 0 ? prods[0] : null;

    if (firstProd) {
      const thumb = firstProd.image || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png';
      const title = firstProd.title || 'Sản phẩm TikTok Shop';
      const price = firstProd.price || 'Xem trên Shop';
      const countTag = prods.length > 1 ? ` • ${prods.length} sản phẩm` : '';

      badge.innerHTML = `
        <img class="kbeauty-mobile-cart-thumb" src="${escapeHtml(thumb)}" alt="Product" onerror="this.style.display='none'" />
        <div class="kbeauty-mobile-cart-text-wrap">
          <div class="kbeauty-mobile-cart-tag">🛒 Giỏ hàng TikTok${countTag}</div>
          <div class="kbeauty-mobile-cart-name" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="kbeauty-mobile-cart-price">${escapeHtml(price)}</div>
        </div>
        <button class="kbeauty-mobile-cart-btn" title="Mở giỏ hàng TikTok">Mở Giỏ Hàng ↗</button>
        <button class="kbeauty-mobile-cart-close" title="Ẩn tạm">✕</button>
      `;
    } else {
      badge.innerHTML = `
        <div style="font-size: 22px; line-height: 1; flex-shrink: 0;">🛒</div>
        <div class="kbeauty-mobile-cart-text-wrap">
          <div class="kbeauty-mobile-cart-tag">🛒 Giỏ hàng TikTok</div>
          <div class="kbeauty-mobile-cart-name">Video có gắn giỏ hàng sản phẩm</div>
          <div class="kbeauty-mobile-cart-price">Bấm xem shop & link mua</div>
        </div>
        <button class="kbeauty-mobile-cart-btn" title="Mở giỏ hàng TikTok">Mở Giỏ Hàng ↗</button>
        <button class="kbeauty-mobile-cart-close" title="Ẩn tạm">✕</button>
      `;
    }

    badge.onclick = (e) => {
      if (e.target.closest('.kbeauty-mobile-cart-close')) {
        e.stopPropagation();
        e.preventDefault();
        badge.setAttribute('data-dismissed-vid', currentVid);
        badge.style.display = 'none';
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      openDrawer();
    };
  }

  // UI Setup
  function initUI() {
    const oldRoot = document.getElementById('kbeauty-root');
    if (oldRoot) {
      oldRoot.remove();
    }

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'kbeauty-root';
    document.body.appendChild(overlayContainer);

    floatingHubBtn = document.createElement('button');
    floatingHubBtn.id = 'kbeauty-floating-hub';
    floatingHubBtn.title = 'Kbeautyhub - Giỏ hàng TikTok PC (Bấm để xem)';
    floatingHubBtn.innerHTML = `
      <div class="kbeauty-hub-icon">🛍️</div>
      <div class="kbeauty-hub-badge" id="kbeauty-hub-badge">0</div>
      <div class="kbeauty-hub-label" id="kbeauty-hub-label">Giỏ hàng PC</div>
    `;
    floatingHubBtn.addEventListener('click', toggleDrawer);
    overlayContainer.appendChild(floatingHubBtn);

    drawerElement = document.createElement('div');
    drawerElement.id = 'kbeauty-drawer';
    drawerElement.className = 'kbeauty-drawer-hidden';
    drawerElement.style.display = 'none';
    drawerElement.innerHTML = `
      <div class="kbeauty-drawer-backdrop" id="kbeauty-drawer-backdrop"></div>
      <div class="kbeauty-drawer-panel">
        <div class="kbeauty-drawer-header">
          <div class="kbeauty-header-title">
            <span class="kbeauty-logo">🛍️ Kbeautyhub</span>
            <span class="kbeauty-subtitle">TikTok Shop PC Viewer v1.9.1 • by Son Designer</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="kbeauty-toggle-off-btn" id="kbeauty-drawer-toggle-off" title="Tắt hoàn toàn tiện ích (Bật lại bất cứ lúc nào trong icon Popup)">
              ⏻ Tắt Tiện Ích
            </button>
            <button class="kbeauty-close-btn" id="kbeauty-close-btn" title="Đóng bảng giỏ hàng (ESC)">
              <span style="font-size:14px;">✕</span>
              <span>Đóng</span>
            </button>
          </div>
        </div>
        <div class="kbeauty-drawer-body" id="kbeauty-drawer-body"></div>
        <div class="kbeauty-drawer-footer">
          <div class="kbeauty-footer-credit">
            Developed by <strong>Son Designer</strong> • Kbeautyhub
          </div>
        </div>
      </div>
    `;

    overlayContainer.appendChild(drawerElement);

    const handleClose = (e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      closeDrawer();
    };

    drawerElement.querySelector('#kbeauty-close-btn')?.addEventListener('click', handleClose);
    drawerElement.querySelector('#kbeauty-drawer-backdrop')?.addEventListener('click', handleClose);

    // Turn off extension directly from drawer
    drawerElement.querySelector('#kbeauty-drawer-toggle-off')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (confirm('Bạn có muốn tắt tiện ích Kbeautyhub? Tiện ích sẽ tắt và ngừng can thiệp hoàn toàn. Bạn có thể bật lại bất kỳ lúc nào tại icon Popup trên thanh công cụ.')) {
        await chrome.storage.local.set({ kbeauty_master_enabled: false });
        chrome.runtime.sendMessage({ action: 'SET_MASTER_ENABLED', enabled: false }).catch(() => {});
        tearDownExtension();
      }
    });

    // ESC key listener to close drawer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerElement && drawerElement.classList.contains('kbeauty-drawer-open')) {
        closeDrawer();
      }
    });
  }

  function toggleDrawer() {
    if (!isMasterEnabled) return;
    if (!isUnlocked) {
      alert('🔐 Tiện ích Kbeautyhub chưa được kích hoạt!\n\nVui lòng mở biểu tượng tiện ích (Extensions) trên thanh công cụ của trình duyệt và nhập mật khẩu bảo mật để kích hoạt thiết bị.');
      return;
    }
    if (drawerElement.classList.contains('kbeauty-drawer-open')) closeDrawer();
    else openDrawer();
  }

  function openDrawer() {
    renderDrawerContent();
    drawerElement.style.display = 'flex';
    // Small timeout to allow CSS transition
    requestAnimationFrame(() => {
      drawerElement.classList.remove('kbeauty-drawer-hidden');
      drawerElement.classList.add('kbeauty-drawer-open');
    });
  }

  function closeDrawer() {
    drawerElement.classList.remove('kbeauty-drawer-open');
    drawerElement.classList.add('kbeauty-drawer-hidden');
    drawerElement.querySelectorAll('video, audio').forEach(v => {
      try { v.pause(); } catch (e) {}
    });
    setTimeout(() => {
      if (drawerElement.classList.contains('kbeauty-drawer-hidden')) {
        drawerElement.style.display = 'none';
      }
    }, 250);
  }

  function renderPDPShopView(body, productId) {
    let detectedShopName = null;
    const htmlText = document.documentElement.innerHTML;
    const sNameMatch = htmlText.match(/"(?:shop_name|shopName|seller_name|sellerName)"\s*:\s*"([^"]+)"/i)
      || htmlText.match(/"shop_info"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i);
    if (sNameMatch) {
      try {
        detectedShopName = JSON.parse(`"${sNameMatch[1]}"`);
      } catch (e) {
        detectedShopName = sNameMatch[1];
      }
    }

    const shopUrl = detectedShopName 
      ? `https://www.tiktok.com/search?q=${encodeURIComponent(detectedShopName)}`
      : 'https://www.tiktok.com';

    body.innerHTML = `
      <div style="background: #171926; border: 1.5px solid rgba(255, 184, 0, 0.4); border-radius: 12px; padding: 16px; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 20px;">🛍️</span>
          <span style="font-size: 14px; font-weight: 700; color: #FFB800;">Trang Sản Phẩm TikTok Shop PC</span>
        </div>
        <p style="font-size: 11.5px; color: #D1D5E5; line-height: 1.4; margin-bottom: 12px;">
          Bạn đang xem trang sản phẩm TikTok Shop trên trình duyệt. Dưới đây là thông tin gian hàng bán sản phẩm:
        </p>

        <!-- Khối Tên Shop bán sản phẩm -->
        <div class="kbeauty-verified-shop-box" style="margin-top:0; margin-bottom:12px;">
          <div class="verified-shop-left">
            <span class="verified-shop-icon">🏪</span>
            <div class="verified-shop-info">
              <span class="verified-shop-title">Tên Shop bán sản phẩm:</span>
              <strong class="verified-shop-name pdp-verified-name" style="color:#FFFFFF; font-weight:800;">${detectedShopName ? escapeHtml(detectedShopName) : 'TikTok Shop Chính Hãng'}</strong>
            </div>
          </div>
          <a href="${shopUrl}" target="_blank" rel="noopener noreferrer" class="verified-shop-btn pdp-verified-btn">
            ↗️ Vào Shop
          </a>
        </div>

        <!-- Link Gian Hàng / Tìm Shop -->
        <div class="kbeauty-link-field" style="margin-bottom: 10px;">
          <span class="kbeauty-link-label">🌐 Link gian hàng / Tìm Shop trên TikTok:</span>
          <div class="kbeauty-link-box">
            <input type="text" readonly class="kbeauty-link-input pdp-shop-input" value="${escapeHtml(shopUrl)}" />
            <button class="kbeauty-btn-copy pdp-shop-copy" data-copy="${escapeHtml(shopUrl)}">📋 Copy</button>
            <a href="${shopUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-secondary pdp-shop-link-btn" style="flex:none; padding:4px 8px; font-size:11px;">↗️ Xem Shop</a>
          </div>
        </div>

        <!-- Link Trang Sản Phẩm Hiện Tại -->
        <div class="kbeauty-link-field" style="margin-bottom: 14px;">
          <span class="kbeauty-link-label">🛍️ Link sản phẩm hiện tại:</span>
          <div class="kbeauty-link-box">
            <input type="text" readonly class="kbeauty-link-input" value="${escapeHtml(window.location.href)}" />
            <button class="kbeauty-btn-copy" data-copy="${escapeHtml(window.location.href)}">📋 Copy</button>
          </div>
        </div>

        <div style="text-align: center;">
          <a href="https://www.tiktok.com" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-primary" style="display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:7px 16px;">
            🎬 Quay lại trang video TikTok
          </a>
        </div>
      </div>
    `;

    // Attach copy button listeners
    body.querySelectorAll('.kbeauty-btn-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const copyText = btn.getAttribute('data-copy') || '';
        if (copyText) {
          navigator.clipboard.writeText(copyText).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✅ Đã chép!';
            btn.style.color = '#25F4EE';
            setTimeout(() => {
              btn.textContent = orig;
              btn.style.color = '';
            }, 1500);
          });
        }
      });
    });

    body.querySelectorAll('.kbeauty-link-input').forEach(inp => {
      inp.addEventListener('click', () => { inp.select(); });
    });

    // If not detected from DOM yet, ask background via RESOLVE_PDP_SHOP_INFO
    if (!detectedShopName && productId) {
      chrome.runtime.sendMessage({ action: 'RESOLVE_PDP_SHOP_INFO', productId }, (res) => {
        if (res && res.success && res.shopName) {
          const sName = res.shopName;
          const sUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(sName)}`;
          const vName = body.querySelector('.pdp-verified-name');
          if (vName) vName.textContent = sName;
          const vBtn = body.querySelector('.pdp-verified-btn');
          if (vBtn) vBtn.href = sUrl;
          const sInput = body.querySelector('.pdp-shop-input');
          if (sInput) sInput.value = sUrl;
          const sCopy = body.querySelector('.pdp-shop-copy');
          if (sCopy) sCopy.setAttribute('data-copy', sUrl);
          const sLinkBtn = body.querySelector('.pdp-shop-link-btn');
          if (sLinkBtn) sLinkBtn.href = sUrl;
        }
      });
    }
  }

  function renderDrawerContent() {
    const body = document.getElementById('kbeauty-drawer-body');
    if (!body) return;

    const vid = currentActiveVideoId || getUrlVideoId();

    if (!vid) {
      // 1. Check if user is on TikTok Shop PDP (e.g. shop.tiktok.com/vn/pdp/...)
      const pdpMatch = window.location.pathname.match(/\/pdp\/(\d+)/);
      if (pdpMatch) {
        renderPDPShopView(body, pdpMatch[1]);
        return;
      }

      // 2. Check if user is on a creator profile page (/ @username)
      const username = getProfileUsername();
      if (username) {
        const showcaseUrl = `https://www.tiktok.com/@${username}`;
        body.innerHTML = `
          <div style="background: #171926; border: 1.5px solid rgba(255, 184, 0, 0.4); border-radius: 12px; padding: 16px; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 18px;">👤</span>
              <span style="font-size: 13.5px; font-weight: 700; color: #FFB800;">Trang cá nhân Creator: @${escapeHtml(username)}</span>
            </div>
            <p style="font-size: 11.5px; color: #D1D5E5; line-height: 1.4; margin-bottom: 12px;">
              Bạn đang xem kênh của creator @${escapeHtml(username)}. Hãy bấm vào một video bất kỳ để xem giỏ hàng và mở khóa video phát trên PC!
            </p>

            <div class="kbeauty-link-field" style="margin-bottom: 10px;">
              <span class="kbeauty-link-label">🌐 Link Kênh TikTok:</span>
              <div class="kbeauty-link-box">
                <input type="text" readonly class="kbeauty-link-input" value="${escapeHtml(showcaseUrl)}" />
                <button class="kbeauty-btn-copy" data-copy="${escapeHtml(showcaseUrl)}">📋 Copy</button>
                <a href="${showcaseUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-primary" style="flex:none; padding:4px 8px; font-size:11px;">↗️ Mở Kênh</a>
              </div>
            </div>
          </div>
        `;
        body.querySelectorAll('.kbeauty-btn-copy').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const copyText = btn.getAttribute('data-copy') || '';
            if (copyText) {
              navigator.clipboard.writeText(copyText).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✅ Đã chép!';
                btn.style.color = '#25F4EE';
                setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
              });
            }
          });
        });
        body.querySelectorAll('.kbeauty-link-input').forEach(inp => {
          inp.addEventListener('click', () => { inp.select(); });
        });
        return;
      }

      // 3. Fallback when on general page
      body.innerHTML = `
        <div style="background: #171926; border: 1.5px solid rgba(255, 184, 0, 0.4); border-radius: 12px; padding: 18px; margin-bottom: 14px; text-align: center;">
          <div style="font-size: 28px; margin-bottom: 6px;">🛍️</div>
          <h4 style="font-size: 14px; font-weight: 700; color: #FFB800; margin-bottom: 6px;">Kbeautyhub - TikTok Shop PC</h4>
          <p style="font-size: 11.5px; color: #D1D5E5; line-height: 1.5; margin-bottom: 14px;">
            Hãy bấm chọn một video bất kỳ trên TikTok để tự động quét giỏ hàng, xem tên Shop bán sản phẩm và mở khóa video trên PC.
          </p>
          <a href="https://www.tiktok.com/foryou" class="kbeauty-btn kbeauty-btn-primary" style="display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:6px 14px;">
            ▶️ Xem Video Dành Cho Bạn
          </a>
        </div>
      `;
      return;
    }

    let videoData = videoDataMap.get(vid);
    if (!videoData) videoData = parseRehydrationData();

    if (!videoData || !videoData.playAddr) {
      body.innerHTML = `
        <div class="kbeauty-empty-state">
          <div class="kbeauty-empty-icon">⏳</div>
          <h3>Đang giải mã video trực tiếp...</h3>
          <p>Video ID: <code>${vid || 'Đang quét'}</code></p>
          <button id="kbeauty-btn-retry" class="kbeauty-btn kbeauty-btn-primary" style="margin-top:12px;">
            ⚡ Lấy video & Mở khóa ngay
          </button>
        </div>
      `;
      document.getElementById('kbeauty-btn-retry')?.addEventListener('click', async () => {
        const btn = document.getElementById('kbeauty-btn-retry');
        if (btn) btn.textContent = '⏳ Đang tải link...';
        await resolveStreamViaTikWM(vid);
        renderDrawerContent();
      });
      return;
    }

    const currentUrl = `https://www.tiktok.com/@${videoData.author?.uniqueId || 'user'}/video/${videoData.videoId}`;
    const products = videoData.products || [];

    let html = `
      <div class="kbeauty-video-meta">
        <div class="kbeauty-author-chip">
          <img src="${videoData.author?.avatar || 'https://www.tiktok.com/favicon.ico'}" class="kbeauty-avatar" />
          <span>@${escapeHtml(videoData.author?.uniqueId || 'creator')}</span>
        </div>
        <div class="kbeauty-count-tag">
          ${products.length > 0 ? `${products.length} sản phẩm` : 'TikTok Shop'}
        </div>
      </div>

      <!-- Embedded Player Inside Drawer (Muted & Preload None to prevent dual audio) -->
      <div style="background: #000; border-radius: 12px; overflow: hidden; margin-bottom: 14px; position: relative;">
        <video id="kbeauty-drawer-video" src="${videoData.playAddr}" controls muted loop preload="none" style="width: 100%; max-height: 280px; object-fit: contain; display: block;"></video>
      </div>

      <div style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button id="kbeauty-unblock-play-btn" class="kbeauty-btn kbeauty-btn-primary" style="flex:1;">
          🎬 Phát lên khung trang chính
        </button>
        <a href="${videoData.playAddr}" download="tiktok_${videoData.videoId}.mp4" target="_blank" class="kbeauty-btn kbeauty-btn-ghost" title="Tải video">
          📥 Tải MP4
        </a>
      </div>
    `;

    if (products.length > 0) {
      html += `<div class="kbeauty-products-list">`;
      products.forEach((prod, index) => {
        const img = prod.image || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png';
        const fallbackUrl = prod.webUrl || (prod.productId ? `https://shop.tiktok.com/vn/pdp/${prod.productId}?source=anchor` : currentUrl);

        // Immediate cache & detection lookup for Real Shop Name
        let realShopName = '';
        if (prod.isRealShop && prod.shopName) {
          realShopName = prod.shopName;
        } else if (prod.productId && shopNameCache.has(prod.productId)) {
          realShopName = shopNameCache.get(prod.productId);
          prod.shopName = realShopName;
          prod.isRealShop = true;
        } else if (prod.sellerId && sellerShopCache.has(prod.sellerId)) {
          realShopName = sellerShopCache.get(prod.sellerId);
          prod.shopName = realShopName;
          prod.isRealShop = true;
        } else if (prod.shopName && !prod.shopName.includes('TikTok Shop (') && !prod.shopName.startsWith('Shop của @') && !prod.shopName.startsWith('Shop ID:')) {
          realShopName = prod.shopName;
          prod.isRealShop = true;
        }

        const authorNick = videoData.author?.nickname || '';
        const authorUId = videoData.author?.uniqueId || '';
        const creatorShowcaseTitle = (authorNick && authorUId)
          ? `${authorNick} (@${authorUId})`
          : (authorUId ? `@${authorUId}` : 'TikTok Shop');

        const resolvedShopName = realShopName || prod.shopName || creatorShowcaseTitle;
        const displayShopName = resolvedShopName;
        const shopUrl = (realShopName && !realShopName.includes('(@'))
          ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
          : (authorUId 
              ? `https://www.tiktok.com/@${authorUId}` 
              : fallbackUrl);

        const verifiedShopHtml = `<span style="color:#FFFFFF; font-weight:800;">${escapeHtml(resolvedShopName)}</span>`;

        html += `
          <div class="kbeauty-product-card" data-index="${index}" data-pid="${escapeHtml(prod.productId || '')}">
            <!-- Top Header Row: Image + Title + Price (No squishing) -->
            <div class="kbeauty-card-top-row">
              <div class="kbeauty-card-thumb">
                <img src="${img}" alt="${escapeHtml(prod.title)}" loading="lazy" />
              </div>
              <div class="kbeauty-card-header-info">
                <h4 class="kbeauty-product-title" title="${escapeHtml(prod.title)}">${escapeHtml(prod.title)}</h4>
                <div class="kbeauty-price-row">
                  <span class="kbeauty-price-tag">${escapeHtml(prod.price || 'Xem giá trên Shop')}</span>
                  ${prod.sales ? `<span class="kbeauty-sales-tag">Đã bán: ${escapeHtml(prod.sales)}</span>` : ''}
                </div>
              </div>
            </div>

            <!-- Full-Width Shop & Cart Link Section: 100% card width, zero clipping -->
            <div class="kbeauty-shop-box">
              <div class="kbeauty-shop-header">
                <span>🏪 Gian hàng:</span>
                <strong class="kbeauty-shop-name-text">${escapeHtml(displayShopName)}</strong>
                ${prod.sellerId ? `<span style="font-size:10px; color:#9297AE; margin-left:auto;">ID: ${escapeHtml(prod.sellerId)}</span>` : ''}
              </div>

              <!-- Link Gian Hang Shop -->
              <div class="kbeauty-link-field">
                <span class="kbeauty-link-label">🌐 Link gian hàng / Tìm Shop:</span>
                <div class="kbeauty-link-box">
                  <input type="text" readonly class="kbeauty-link-input kbeauty-shop-link-input" value="${escapeHtml(shopUrl)}" />
                  <button class="kbeauty-btn-copy kbeauty-shop-copy-btn" data-copy="${escapeHtml(shopUrl)}">📋 Copy</button>
                  <a href="${shopUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-secondary kbeauty-shop-link-btn">↗️ Xem Shop</a>
                </div>
              </div>

              <!-- Link San Pham Gio Hang -->
              <div class="kbeauty-link-field">
                <span class="kbeauty-link-label">🛍️ Link sản phẩm gắn giỏ hàng:</span>
                <div class="kbeauty-link-box">
                  <input type="text" readonly class="kbeauty-link-input" value="${escapeHtml(fallbackUrl)}" />
                  <button class="kbeauty-btn-copy" data-copy="${escapeHtml(fallbackUrl)}">📋 Copy</button>
                  <a href="${fallbackUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-primary">↗️ Mở SP</a>
                </div>
              </div>

              <!-- PHÍA DƯỚI LINK: TÊN SHOP BÁN CHÍNH THỨC -->
              <div class="kbeauty-verified-shop-box">
                <div class="verified-shop-left">
                  <span class="verified-shop-icon">🏪</span>
                  <div class="verified-shop-info">
                    <span class="verified-shop-title">Tên Shop bán sản phẩm:</span>
                    <strong class="verified-shop-name">
                      ${verifiedShopHtml}
                    </strong>
                  </div>
                </div>
                <a href="${shopUrl}" target="_blank" rel="noopener noreferrer" class="verified-shop-btn">
                  ↗️ Vào Shop
                </a>
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    } else if (videoData.hasShopCart) {
      const authorId = videoData.author?.uniqueId || 'creator';
      const creatorShowcaseUrl = `https://www.tiktok.com/@${authorId}`;
      const realShopName = videoData.shopName && !videoData.shopName.includes('TikTok Shop (') ? videoData.shopName : '';
      const shopSellerUrl = realShopName 
        ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
        : creatorShowcaseUrl;
      const shopDisplayName = realShopName || (videoData.sellerId ? `Shop ID: ${videoData.sellerId}` : `Shop của @${authorId}`);
      const productDirectUrl = `https://www.tiktok.com/@${authorId}/video/${videoData.videoId}?is_copy_url=1&is_from_webapp=1`;

      html += `
        <div style="background: #171926; border: 1.5px solid rgba(255, 184, 0, 0.4); border-radius: 12px; padding: 14px; margin-bottom: 14px; box-sizing: border-box;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 18px;">🛒</span>
            <span style="font-size: 13.5px; font-weight: 700; color: #FFB800;">Video có gắn giỏ hàng TikTok Shop!</span>
          </div>
          <p style="font-size: 11.5px; color: #D1D5E5; line-height: 1.4; margin-bottom: 12px;">
            Video này được xác nhận có gắn giỏ hàng bán sản phẩm. Dưới đây là chi tiết link Shop và gian hàng:
          </p>

          <!-- 1. Link Shop Ban San Pham -->
          <div class="kbeauty-link-field" style="margin-bottom: 10px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
              <span class="kbeauty-link-label" style="color: #FFB800; font-weight: 700;">🏪 Link Shop bán sản phẩm:</span>
              <span style="font-size:10px; color:#A0A4B8;">${escapeHtml(shopDisplayName)}</span>
            </div>
            <div class="kbeauty-link-box">
              <input type="text" readonly class="kbeauty-link-input" value="${escapeHtml(shopSellerUrl)}" />
              <button class="kbeauty-btn-copy" data-copy="${escapeHtml(shopSellerUrl)}">📋 Copy</button>
              <a href="${shopSellerUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-secondary">↗️ Xem Shop</a>
            </div>
          </div>

          <!-- 2. Link Gio Hang Video -->
          <div class="kbeauty-link-field" style="margin-bottom: 10px;">
            <span class="kbeauty-link-label" style="color: #25F4EE; font-weight: 700;">🛍️ Link sản phẩm gắn giỏ hàng của video:</span>
            <div class="kbeauty-link-box">
              <input type="text" readonly class="kbeauty-link-input" value="${escapeHtml(productDirectUrl)}" />
              <button class="kbeauty-btn-copy" data-copy="${escapeHtml(productDirectUrl)}">📋 Copy</button>
              <a href="${productDirectUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-primary">↗️ Mở Giỏ Hàng</a>
            </div>
          </div>

          <!-- 3. Gian Hang Showcase Cua Creator -->
          <div class="kbeauty-link-field" style="margin-bottom: 12px;">
            <span class="kbeauty-link-label">👤 Gian hàng Showcase của Creator (@${escapeHtml(authorId)}):</span>
            <div class="kbeauty-link-box">
              <input type="text" readonly class="kbeauty-link-input" value="${escapeHtml(creatorShowcaseUrl)}" />
              <button class="kbeauty-btn-copy" data-copy="${escapeHtml(creatorShowcaseUrl)}">📋 Copy</button>
              <a href="${creatorShowcaseUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-secondary">↗️ Xem Showcase</a>
            </div>
          </div>

          <!-- Phía dưới link: Tên Shop -->
          <div class="kbeauty-verified-shop-box">
            <div class="verified-shop-left">
              <span class="verified-shop-icon">🏪</span>
              <div class="verified-shop-info">
                <span class="verified-shop-title">Tên Shop bán sản phẩm:</span>
                <strong class="verified-shop-name">${escapeHtml(shopDisplayName)}</strong>
              </div>
            </div>
            <a href="${shopSellerUrl}" target="_blank" rel="noopener noreferrer" class="verified-shop-btn">
              ↗️ Vào Shop
            </a>
          </div>
        </div>
      `;
    } else {
      // Video KHÔNG CÓ GIỎ HÀNG
      const authorId = videoData.author?.uniqueId || 'creator';
      const creatorShowcaseUrl = `https://www.tiktok.com/@${authorId}`;
      html += `
        <div style="background: rgba(239, 68, 68, 0.08); border: 1.5px dashed rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 18px 14px; text-align: center; margin-bottom: 14px; box-sizing: border-box;">
          <div style="font-size: 26px; margin-bottom: 6px;">❌</div>
          <h4 style="font-size: 13.5px; font-weight: 700; color: #F87171; margin-bottom: 4px;">Video này KHÔNG gắn giỏ hàng TikTok Shop</h4>
          <p style="font-size: 11.5px; color: #9CA3AF; line-height: 1.4; margin-bottom: 12px;">
            Người sáng tạo (@${escapeHtml(authorId)}) không gắn link bán sản phẩm trong video này.
          </p>
          <a href="${creatorShowcaseUrl}" target="_blank" rel="noopener noreferrer" class="kbeauty-btn kbeauty-btn-secondary" style="font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px;">
            👤 Xem kênh của Creator (@${escapeHtml(authorId)})
          </a>
        </div>
      `;
    }

    body.innerHTML = html;

    // Asynchronously resolve real shop name from PDP if not yet available
    if (products.length > 0) {
      products.forEach((prod) => {
        if (prod.productId && (!prod.shopName || !prod.isRealShop || prod.shopName.includes('TikTok Shop (') || prod.shopName.startsWith('Shop của @') || prod.shopName.startsWith('Shop ID:'))) {
          resolveRealShopName(prod, videoData);
        }
      });
    }

    // Attach copy button listeners
    body.querySelectorAll('.kbeauty-btn-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const copyText = btn.getAttribute('data-copy') || '';
        if (copyText) {
          navigator.clipboard.writeText(copyText).then(() => {
            const originalText = btn.textContent;
            btn.textContent = '✅ Đã chép!';
            btn.style.color = '#25F4EE';
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.color = '';
            }, 1500);
          }).catch(() => {});
        }
      });
    });

    // Auto-select text on input click
    body.querySelectorAll('.kbeauty-link-input').forEach(inp => {
      inp.addEventListener('click', () => {
        inp.select();
      });
    });

    const dVid = body.querySelector('#kbeauty-drawer-video');
    if (dVid) {
      dVid.addEventListener('play', () => {
        const mainV = document.getElementById('kbeauty-main-video');
        if (mainV) mainV.pause();
        document.querySelectorAll('video, audio').forEach(v => {
          if (v !== dVid) {
            try { v.pause(); v.muted = true; } catch (e) {}
          }
        });
      });
    }

    document.getElementById('kbeauty-unblock-play-btn')?.addEventListener('click', () => {
      const drawerV = body.querySelector('#kbeauty-drawer-video');
      if (drawerV) drawerV.pause();
      unblockAndPlay(videoData.playAddr, true);
      closeDrawer();
    });
  }

  function updateFloatingHubPosition() {
    if (!isMasterEnabled || !floatingHubBtn) return;

    if (!getUrlVideoId()) {
      // On profile or general feed: position at top right without blocking content
      floatingHubBtn.style.position = 'fixed';
      floatingHubBtn.style.top = '78px';
      floatingHubBtn.style.right = '24px';
      floatingHubBtn.style.left = 'auto';
      return;
    }

    // Look for the comments or suggestions sidebar on the right
    const sidebar = document.querySelector('[data-e2e="comment-list"]') || 
                    document.querySelector('div[class*="DivCommentContainer"]') ||
                    document.querySelector('div[class*="RightContainer"]') ||
                    document.querySelector('div[class*="DivSidebarContainer"]') ||
                    document.querySelector('div[class*="TabContainer"]');

    const videoBox = document.getElementById('kbeauty-unblocked-player-box') ||
                     document.querySelector('[data-e2e="browse-video"]') ||
                     document.querySelector('div[class*="DivVideoContainer"]') ||
                     document.querySelector('div[class*="PlayerContainer"]') ||
                     document.querySelector('video');

    if (sidebar) {
      const sRect = sidebar.getBoundingClientRect();
      if (sRect.left > 350) {
        // Position directly in the empty gap just to the left of sidebar
        floatingHubBtn.style.position = 'fixed';
        floatingHubBtn.style.right = Math.max(16, Math.round(window.innerWidth - sRect.left + 24)) + 'px';
        floatingHubBtn.style.left = 'auto';
        floatingHubBtn.style.top = '78px';
        return;
      }
    }

    if (videoBox) {
      const vRect = videoBox.getBoundingClientRect();
      if (vRect.right > 150 && vRect.right < window.innerWidth - 200) {
        // Position directly to the right of the video
        floatingHubBtn.style.position = 'fixed';
        floatingHubBtn.style.left = Math.round(vRect.right + 25) + 'px';
        floatingHubBtn.style.right = 'auto';
        floatingHubBtn.style.top = '78px';
        return;
      }
    }

    // Default: sitting outside 480px sidebar at top 78px
    floatingHubBtn.style.position = 'fixed';
    floatingHubBtn.style.right = '520px';
    floatingHubBtn.style.left = 'auto';
    floatingHubBtn.style.top = '78px';
  }

  let lastActiveVideoId = null;

  // Update UI & Unblock Video
  async function updateUI() {
    if (!isMasterEnabled) {
      applyExtensionState();
      return;
    }

    if (!isUnlocked) {
      applyExtensionState();
      return;
    }

    const vid = getUrlVideoId();
    if (!vid) {
      const staleBox = document.getElementById('kbeauty-unblocked-player-box');
      if (staleBox) {
        staleBox.remove();
        lastMountedStreamUrl = null;
        lastMountedVideoId = null;
      }
      if (currentActiveVideoId !== null) {
        currentActiveVideoId = null;
        lastActiveVideoId = null;
        const badgeEl = document.getElementById('kbeauty-hub-badge');
        const labelEl = document.getElementById('kbeauty-hub-label');
        if (badgeEl) badgeEl.style.display = 'none';
        if (labelEl) labelEl.textContent = '🛍️ Giỏ hàng TikTok';
        if (floatingHubBtn) {
          floatingHubBtn.classList.remove('kbeauty-pulse-glow');
          floatingHubBtn.style.borderColor = '#FE2C55';
        }
        updateFloatingHubPosition();
        updateInVideoCartBadge(null);
        if (drawerElement && drawerElement.classList.contains('kbeauty-drawer-open')) {
          renderDrawerContent();
        }
      }
      return;
    }

    const videoChanged = (lastActiveVideoId !== vid);
    currentActiveVideoId = vid;
    lastActiveVideoId = vid;

    let data = videoDataMap.get(vid);
    if (!data) data = parseRehydrationData(vid);

    // 1. If stream URL is missing, resolve it via TikWM through background service worker
    if (!data || !data.playAddr) {
      if (!resolvingSet.has(vid)) {
        data = await resolveStreamViaTikWM(vid);
      }
    }

    // 2. Real-time DOM Anchor detection (catches tags like 'Rosaleen', yellow cart banners)
    const domAnchor = findDOMShopAnchor();
    if (domAnchor && domAnchor.isShop) {
      if (!data) {
        data = {
          videoId: vid,
          desc: '',
          author: { uniqueId: getProfileUsername() || 'creator' },
          products: [],
          hasShopCart: true,
          shopName: domAnchor.title,
          capturedAt: Date.now()
        };
        videoDataMap.set(vid, data);
      } else {
        data.hasShopCart = true;
        if (!data.shopName || data.shopName === 'TikTok Shop') {
          data.shopName = domAnchor.title;
        }
      }

      if (data.products.length === 0 && domAnchor.title && domAnchor.title !== 'TikTok Shop') {
        data.products.push({
          productId: '',
          sellerId: '',
          title: domAnchor.title,
          price: 'Xem trên Shop',
          image: 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png',
          webUrl: window.location.href,
          shopUrl: `https://www.tiktok.com/search?q=${encodeURIComponent(domAnchor.title)}`,
          shopName: domAnchor.title,
          isRealShop: true,
          source: 'tiktok_shop'
        });
      }
    }

    // 3. Active Background Deep Scan: If cart is still unconfirmed or streamUrl missing, query TikWM
    if (vid && (!data || !data.hasShopCart || !data.playAddr || (data.products && data.products.length === 0))) {
      if (!resolvingSet.has(vid)) {
        resolveStreamViaTikWM(vid).then(updated => {
          if (updated && currentActiveVideoId === vid) {
            updateUI();
          }
        }).catch(() => {});
      }
    }

    // Auto unblock ONLY if video is actually blocked by TikTok Shop!
    const shouldUnblock = isVideoBlocked(data);
    if (shouldUnblock && data && data.playAddr) {
      unblockAndPlay(data.playAddr);
    } else if (shouldUnblock && (!data || !data.playAddr)) {
      if (!resolvingSet.has(vid)) {
        resolveStreamViaTikWM(vid).then(updated => {
          if (updated && updated.playAddr && currentActiveVideoId === vid) {
            unblockAndPlay(updated.playAddr);
          }
        }).catch(() => {});
      }
    } else {
      // NORMAL OR NATIVELY PLAYING VIDEO: Do NOT touch native player!
      // If custom player was mounted from previous video, remove it cleanly so normal video plays natively!
      const unblockedBox = document.getElementById('kbeauty-unblocked-player-box');
      if (unblockedBox) {
        console.log('[Kbeautyhub] Normal video detected, cleanly removing unblock player box');
        unblockedBox.remove();
        lastMountedStreamUrl = null;
        lastMountedVideoId = null;
      }
      // Guarantee all native videos are visible and unmuted
      document.querySelectorAll('video:not(#kbeauty-main-video):not(#kbeauty-drawer-video)').forEach(v => {
        if (v.style.display === 'none') {
          v.style.display = '';
          v.style.opacity = '';
          v.style.pointerEvents = '';
        }
      });
    }

    // In-video Mobile Cart Badge
    updateInVideoCartBadge(data);

    // CRITICAL: If drawer is currently open and video changed, RE-RENDER DRAWER IMMEDIATELY!
    if (videoChanged && drawerElement && drawerElement.classList.contains('kbeauty-drawer-open')) {
      renderDrawerContent();
    }

    // Broadcast change to popup/background and report device heartbeat
    if (videoChanged) {
      chrome.runtime.sendMessage({
        action: 'ACTIVE_VIDEO_CHANGED',
        videoId: vid,
        videoData: data
      }).catch(() => {});
      sendDeviceHeartbeat(data);
    }

    const badgeEl = document.getElementById('kbeauty-hub-badge');
    const labelEl = document.getElementById('kbeauty-hub-label');

    const isShop = (data && data.hasShopCart) || (data && data.products && data.products.length > 0);
    if (isShop) {
      if (badgeEl) {
        badgeEl.textContent = String(data?.products?.length || 1);
        badgeEl.style.display = 'flex';
      }
      if (labelEl) labelEl.textContent = '🛍️ Giỏ hàng TikTok';
      if (floatingHubBtn) {
        floatingHubBtn.classList.add('kbeauty-pulse-glow');
        floatingHubBtn.style.borderColor = '#FE2C55';
      }
    } else {
      if (badgeEl) badgeEl.style.display = 'none';
      if (labelEl) labelEl.textContent = 'Video không gắn giỏ hàng';
      if (floatingHubBtn) {
        floatingHubBtn.classList.remove('kbeauty-pulse-glow');
        floatingHubBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      }
    }

    updateFloatingHubPosition();
  }

  // Message Handler for Popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_ACTIVE_VIDEO') {
      const vid = message.videoId || getUrlVideoId();
      if (!vid) {
        sendResponse({ currentVideoId: null, videoData: null });
        return true;
      }

      let data = videoDataMap.get(vid);
      if (!data) data = parseRehydrationData(vid);

      if (data) {
        sendResponse({
          currentVideoId: vid,
          videoData: data
        });
        return true;
      }

      (async () => {
        data = await resolveStreamViaTikWM(vid);
        sendResponse({
          currentVideoId: vid,
          videoData: data || null
        });
      })();
      return true;
    }

    if (message.action === 'FORCE_UNBLOCK') {
      const vid = message.videoId || getUrlVideoId();
      (async () => {
        let d = videoDataMap.get(vid) || parseRehydrationData(vid);
        if (!d || !d.playAddr) {
          d = await resolveStreamViaTikWM(vid);
        }
        if (d && d.playAddr) {
          unblockAndPlay(d.playAddr, true);
          sendResponse({ success: true, playAddr: d.playAddr });
        } else {
          sendResponse({ success: false });
        }
      })();
      return true;
    }

    if (message.action === 'MASTER_TOGGLE_CHANGED') {
      setExtensionEnabled(!!message.enabled);
      sendResponse({ success: true, enabled: isMasterEnabled });
      return true;
    }

    if (message.action === 'UNLOCK_STATE_CHANGED') {
      isUnlocked = !!message.unlocked;
      applyExtensionState();
      sendResponse({ success: true, unlocked: isUnlocked });
      return true;
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function boot() {
    if (!isMasterEnabled) return;

    if (isBooted && document.getElementById('kbeauty-root')) {
      applyExtensionState();
      updateUI();
      updateFloatingHubPosition();
      return;
    }

    isBooted = true;
    initUI();
    parseRehydrationData();
    applyExtensionState();
    updateUI();
    updateFloatingHubPosition();

    // Initial heartbeat
    sendDeviceHeartbeat(videoDataMap.get(getUrlVideoId()) || null);

    const triggerUpdate = () => {
      if (!isMasterEnabled) return;
      setTimeout(() => {
        updateUI();
        updateFloatingHubPosition();
      }, 100);
      setTimeout(() => {
        updateUI();
        updateFloatingHubPosition();
      }, 350);
    };

    window.addEventListener('popstate', triggerUpdate);

    // Fast scroll & wheel detection
    let scrollDebounceTimer = null;
    window.addEventListener('scroll', () => {
      if (!isMasterEnabled) return;
      updateFloatingHubPosition();
      clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = setTimeout(updateUI, 160);
    }, { passive: true });

    window.addEventListener('wheel', () => {
      if (!isMasterEnabled) return;
      clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = setTimeout(updateUI, 180);
    }, { passive: true });

    // Keyboard arrow navigation in feed (Up/Down arrow, j/k)
    window.addEventListener('keydown', (e) => {
      if (!isMasterEnabled) return;
      if (['ArrowDown', 'ArrowUp', 'KeyJ', 'KeyK', 'PageDown', 'PageUp'].includes(e.code)) {
        triggerUpdate();
      }
    });

    window.addEventListener('resize', () => {
      if (isMasterEnabled) updateFloatingHubPosition();
    });

    setInterval(() => {
      if (isMasterEnabled) {
        updateUI();
        updateFloatingHubPosition();
      }
    }, 1000);

    // Periodic Heartbeat every 25 seconds for Admin dashboard
    setInterval(() => {
      if (isMasterEnabled) {
        const vid = getUrlVideoId();
        const curData = vid ? (videoDataMap.get(vid) || null) : null;
        sendDeviceHeartbeat(curData);
      }
    }, 25000);
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get(['kbeauty_master_enabled', 'kbeauty_is_unlocked']);
      isMasterEnabled = (data.kbeauty_master_enabled !== false);
      isUnlocked = (data.kbeauty_is_unlocked !== false);
    } catch (e) {
      isMasterEnabled = true;
      isUnlocked = true;
    }

    console.log('[Kbeautyhub] Initialized on page load/F5. isMasterEnabled:', isMasterEnabled);

    if (isMasterEnabled) {
      boot();
    } else {
      tearDownExtension();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
