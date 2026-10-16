/**
 * Kbeautyhub - TikTok View v1.9.4 (Cloud Sync & Multi-Tenant Isolation)
 * Developed by Son Designer
 * Intercepts TikTok API & initial page data cleanly without any polling loops or rate-limit triggers.
 */
(function() {
  'use strict';

  console.log('[Kbeautyhub] Clean interceptor v1.9.4 loaded.');

  const EVENT_NAME = 'KBEAUTY_TIKTOK_DATA_EVENT';

  function emitToExtension(type, data) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { type, data }
      }));
    } catch (err) {}
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
          let title = titleMatch ? titleMatch[1] : (anchor.keyword || anchor.name || 'Sản phẩm TikTok Shop');
          try {
            title = JSON.parse(`"${title}"`);
          } catch (e) {}

          let cover = coverMatch ? coverMatch[1].replace(/\\/g, '') : '';
          const authorUniqueId = item.author?.uniqueId || '';
          const authorNickname = item.author?.nickname || '';
          const creatorShowcaseName = authorNickname ? `${authorNickname} (@${authorUniqueId})` : (authorUniqueId ? `Shop của @${authorUniqueId}` : 'TikTok Shop');
          const finalShopName = extractedShopName || creatorShowcaseName;
          const isReal = !!extractedShopName;

          const seoUrl = seoMatch ? seoMatch[1].replace(/\\/g, '') : (productId ? `https://shop.tiktok.com/vn/pdp/${productId}?source=anchor` : '');
          const webUrl = seoUrl || (productId ? `https://shop.tiktok.com/vn/pdp/${productId}?source=anchor` : 'https://shop.tiktok.com');
          const shopUrl = extractedShopName
            ? `https://www.tiktok.com/search?q=${encodeURIComponent(extractedShopName)}`
            : (authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : (productId ? `https://shop.tiktok.com/vn/pdp/${productId}?source=anchor` : 'https://www.tiktok.com'));

          products.push({
            productId,
            sellerId,
            title,
            price: priceMatch ? priceMatch[1] : 'Xem trên Shop',
            image: cover || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png',
            webUrl,
            shopUrl,
            shopName: finalShopName,
            isRealShop: isReal,
            source: 'tiktok_shop'
          });
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
        const shopDisplayName = (extractedShopName || anchor.keyword || creatorShowcaseName);

        products.push({
          productId: pId,
          sellerId: '',
          title: title,
          price: 'Xem trên Shop',
          image: anchor.thumbnail?.url_list?.[0] || anchor.icon?.url_list?.[0] || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png',
          webUrl: pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : (authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : 'https://shop.tiktok.com'),
          shopUrl: authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://www.tiktok.com'),
          shopName: shopDisplayName,
          isRealShop: !!extractedShopName || !!anchor.keyword,
          source: 'tiktok_shop'
        });
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
        const authorUniqueId = item.author?.uniqueId || '';
        const authorNickname = item.author?.nickname || '';
        const creatorShowcaseName = authorNickname ? `${authorNickname} (@${authorUniqueId})` : (authorUniqueId ? `Shop của @${authorUniqueId}` : 'TikTok Shop');
        const realShopName = p.shop_name || p.seller_name || '';
        const finalShopName = realShopName || creatorShowcaseName;
        const shopUrl = realShopName 
          ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
          : (authorUniqueId ? `https://www.tiktok.com/@${authorUniqueId}` : (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://www.tiktok.com'));

        products.push({
          productId: pId,
          sellerId: sId,
          title: p.title || p.name || 'Sản phẩm TikTok Shop',
          price: p.price || p.format_price || 'Xem trên Shop',
          image: p.cover || p.image || '',
          webUrl: pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://shop.tiktok.com',
          shopUrl,
          shopName: finalShopName,
          isRealShop: !!realShopName,
          source: 'tiktok_shop'
        });
      }
    }

    return products;
  }

  function parseShopAnchor(anchor) {
    const list = extractProductsFromItem({ anchors: [anchor] });
    return list.length > 0 ? list[0] : null;
  }

  function extractPlayAddr(videoObj) {
    if (!videoObj) return '';
    if (typeof videoObj.playAddr === 'string' && videoObj.playAddr.startsWith('http')) return videoObj.playAddr;
    if (typeof videoObj.play_addr === 'string' && videoObj.play_addr.startsWith('http')) return videoObj.play_addr;

    const pa = videoObj.playAddr || videoObj.play_addr;
    if (pa) {
      const list = pa.urlList || pa.UrlList || pa.url_list;
      if (Array.isArray(list)) {
        for (const u of list) {
          if (typeof u === 'string' && u.startsWith('http')) return u;
        }
      }
    }

    const da = videoObj.downloadAddr || videoObj.download_addr;
    if (da) {
      if (typeof da === 'string' && da.startsWith('http')) return da;
      const list = da.urlList || da.UrlList || da.url_list;
      if (Array.isArray(list)) {
        for (const u of list) {
          if (typeof u === 'string' && u.startsWith('http')) return u;
        }
      }
    }

    const bitrates = videoObj.bitrateInfo || videoObj.bitrate_info || videoObj.bitrate;
    if (Array.isArray(bitrates) && bitrates.length > 0) {
      for (const b of bitrates) {
        const bPa = b.PlayAddr || b.playAddr || b.play_addr;
        const bList = bPa?.UrlList || bPa?.urlList || bPa?.url_list;
        if (Array.isArray(bList)) {
          for (const u of bList) {
            if (typeof u === 'string' && u.startsWith('http')) return u;
          }
        }
      }
    }
    return '';
  }

  function extractVideoData(item) {
    if (!item || (!item.id && !item.aweme_id)) return null;

    const videoId = String(item.id || item.aweme_id);
    const desc = item.desc || '';
    const author = {
      id: item.author?.id || item.author?.uniqueId || '',
      uniqueId: item.author?.uniqueId || item.author?.nickname || 'tiktok_user',
      nickname: item.author?.nickname || '',
      avatar: item.author?.avatarMedium || item.author?.avatarThumb || ''
    };

    const stats = {
      diggCount: item.stats?.diggCount || item.statistics?.diggCount || 0,
      shareCount: item.stats?.shareCount || item.statistics?.shareCount || 0,
      commentCount: item.stats?.commentCount || item.statistics?.commentCount || 0,
      playCount: item.stats?.playCount || item.statistics?.playCount || 0
    };

    const products = extractProductsFromItem(item);

    const playAddr = extractPlayAddr(item.video);
    const cover = item.video?.cover || item.video?.originCover || '';

    const hasAnyAnchor = Array.isArray(item.anchors) && item.anchors.length > 0;
    const isEcommerce = products.length > 0 || 
                        !!item.is_ecommerce || 
                        !!item.commercial_video_info || 
                        hasAnyAnchor ||
                        (Array.isArray(item.anchors) && item.anchors.some(a => a.type === 6 || a.type === 33 || a.type === 40 || a.component_key?.includes('ecommerce') || a.component_key?.includes('shop')));

    return {
      videoId,
      desc,
      author,
      stats,
      products,
      sellerId: products.length > 0 ? products[0].sellerId : '',
      shopUrl: products.length > 0 ? products[0].shopUrl : '',
      shopName: products.length > 0 ? products[0].shopName : '',
      hasShopCart: isEcommerce || products.length > 0,
      playAddr,
      cover,
      capturedAt: Date.now()
    };
  }

  function processPayload(json) {
    if (!json || typeof json !== 'object') return;

    const collected = [];
    const candidates = json.itemList || json.item_list || json.items || [];
    if (Array.isArray(candidates)) {
      for (const it of candidates) {
        const v = extractVideoData(it);
        if (v) collected.push(v);
      }
    }

    if (json.itemInfo?.itemStruct) {
      const v = extractVideoData(json.itemInfo.itemStruct);
      if (v) collected.push(v);
    } else if (json.itemStruct) {
      const v = extractVideoData(json.itemStruct);
      if (v) collected.push(v);
    } else if (json.aweme_detail) {
      const v = extractVideoData(json.aweme_detail);
      if (v) collected.push(v);
    }

    if (collected.length > 0) {
      emitToExtension('VIDEOS_BATCH', collected);
    }
  }

  // Hook window.fetch passively (no blocking)
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (
        url.includes('/api/item/') ||
        url.includes('/api/recommend/') ||
        url.includes('/api/post/item_list') ||
        url.includes('item_list') ||
        url.includes('/api/feed/') ||
        url.includes('/api/related/') ||
        url.includes('web_api')
      ) {
        const clone = response.clone();
        clone.json().then(data => {
          processPayload(data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // Hook XMLHttpRequest passively
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.addEventListener('load', function() {
        try {
          const urlStr = String(url || '');
          if (
            urlStr.includes('/api/item/') ||
            urlStr.includes('/api/recommend/') ||
            urlStr.includes('/api/post/item_list') ||
            urlStr.includes('item_list') ||
            urlStr.includes('/api/feed/') ||
            urlStr.includes('/api/related/') ||
            urlStr.includes('web_api')
          ) {
            const text = this.responseText;
            if (text && text.charCodeAt(0) === 123) { // starts with '{'
              processPayload(JSON.parse(text));
            }
          }
        } catch (e) {}
      });
      return origOpen.apply(this, [method, url, ...rest]);
    };
  } catch (e) {}

  // Hook SPA History Navigation (instant video change detection)
  try {
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      const res = originalPushState.apply(this, args);
      emitToExtension('SPA_NAVIGATE', { url: window.location.href });
      return res;
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      const res = originalReplaceState.apply(this, args);
      emitToExtension('SPA_NAVIGATE', { url: window.location.href });
      return res;
    };
  } catch (e) {}

  // Passive initial parse (Runs once)
  function scanInitialPageData() {
    try {
      const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (script && script.textContent) {
        const parsed = JSON.parse(script.textContent);
        const defaultScope = parsed['__DEFAULT_SCOPE__'] || parsed;
        const videoDetail = defaultScope['webapp.video-detail'];
        if (videoDetail?.itemInfo?.itemStruct) {
          const v = extractVideoData(videoDetail.itemInfo.itemStruct);
          if (v) emitToExtension('VIDEOS_BATCH', [v]);
        }
      }
    } catch (err) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanInitialPageData, { once: true });
  } else {
    scanInitialPageData();
  }

})();
