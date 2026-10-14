/**
 * Kbeautyhub - Popup Controller v1.8.5
 * Developed by Son Designer
 * Accurately tracks current active video on TikTok tab and excludes non-shop anchors.
 */

let currentRenderedVideoId = null;
let adminRefreshInterval = null;
let currentUserRole = 'guest';

// Listen for live video change events from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'ACTIVE_VIDEO_CHANGED') {
    const { videoId, videoData } = message;
    if (videoId && videoId !== currentRenderedVideoId) {
      currentRenderedVideoId = videoId;
      if (videoData && videoData.hasShopCart) {
        renderCurrentVideo(videoData);
      } else if (videoData) {
        renderNoCartVideo(videoData);
      } else {
        renderPendingVideo(videoId);
      }
    }
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  // Check Activation & Unlock Status
  await initActivationState();

  // Initialize Master ON/OFF Switch
  await initMasterToggle();

  // Tab switching with Admin Gatekeeper
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(targetId) {
    tabs.forEach(t => {
      if (t.getAttribute('data-tab') === targetId) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });

    tabContents.forEach(c => {
      if (c.id === targetId) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });

    if (targetId === 'tab-history') {
      loadHistory();
    } else if (targetId === 'tab-admin') {
      loadAdminData();
      if (!adminRefreshInterval) {
        adminRefreshInterval = setInterval(() => {
          const adminTab = document.getElementById('tab-admin');
          if (adminTab && adminTab.classList.contains('active')) {
            loadAdminData();
          }
        }, 3000);
      }
    } else {
      if (adminRefreshInterval) {
        clearInterval(adminRefreshInterval);
        adminRefreshInterval = null;
      }
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');

      // Admin access gatekeeper: If role is guest, require Admin password
      if (targetId === 'tab-admin' && currentUserRole !== 'admin') {
        const pass = prompt('🔐 Vui lòng nhập Mật khẩu Admin (kbeautyhub) để truy cập Bảng quản trị:');
        if (!pass) return; // User cancelled

        chrome.runtime.sendMessage({ action: 'VERIFY_ACTIVATION_PASSWORD', password: pass.trim() }, (res) => {
          if (res && res.success && res.role === 'admin') {
            applyRolePermissions('admin');
            switchTab('tab-admin');
          } else {
            alert('❌ Mật khẩu Admin không chính xác!');
          }
        });
        return;
      }

      switchTab(targetId);
    });
  });

  // Clean false CapCut entries from storage on launch
  await cleanFalseEntries();

  // Check active tab and active video
  await inspectActiveTab();

  // Live auto-sync with TikTok tab while popup is open (tracks feed scrolling)
  setInterval(inspectActiveTab, 1500);

  // Load history count
  await updateHistoryCount();

  // Search input in history
  const searchInput = document.getElementById('history-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterHistory(e.target.value.trim().toLowerCase());
    });
  }

  // Reload buttons (directly reloads extension & tab)
  document.getElementById('btn-quick-reload')?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url?.includes('tiktok.com')) {
        chrome.tabs.reload(tab.id, { bypassCache: true });
      }
    } catch (e) {}
    setTimeout(() => {
      chrome.runtime.reload();
    }, 200);
  });

  document.getElementById('btn-reload-extension')?.addEventListener('click', () => {
    chrome.runtime.reload();
  });

  // Export buttons
  document.getElementById('btn-export-excel')?.addEventListener('click', exportExcel);
  document.getElementById('btn-history-export-excel')?.addEventListener('click', exportExcel);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
  document.getElementById('btn-export-json')?.addEventListener('click', exportJSON);
  document.getElementById('btn-open-tiktok')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.tiktok.com' });
  });
  document.getElementById('btn-clear-history')?.addEventListener('click', clearHistory);

  // Admin buttons
  document.getElementById('btn-lock-extension')?.addEventListener('click', handleLockExtension);
  document.getElementById('btn-change-admin-password')?.addEventListener('click', handleChangeAdminPassword);
  document.getElementById('btn-change-guest-password')?.addEventListener('click', handleChangeGuestPassword);

  // Admin Multi-Tenant Device Filter
  document.getElementById('admin-device-filter-select')?.addEventListener('change', (e) => {
    currentTargetDeviceId = e.target.value;
    loadHistory();
  });

  // Cloud Synchronization & Auto-Update buttons
  document.getElementById('btn-save-cloud-url')?.addEventListener('click', handleSaveCloudUrl);
  document.getElementById('btn-force-cloud-sync')?.addEventListener('click', handleForceCloudSync);
  document.getElementById('btn-open-google-sheet')?.addEventListener('click', handleOpenGoogleSheet);
  document.getElementById('btn-copy-gas-code')?.addEventListener('click', handleCopyGasCode);

  // Check update banner
  checkUpdateBanner();
});

// Clean out non-shop entries (like CapCut) from local storage
async function cleanFalseEntries() {
  try {
    const data = await chrome.storage.local.get('kbeauty_history');
    const history = data.kbeauty_history || [];
    const valid = history.filter(item => {
      if (!item.products || item.products.length === 0) return false;
      return item.products.some(p => {
        const title = (p.title || '').toLowerCase();
        return !title.includes('capcut');
      });
    });
    if (valid.length !== history.length) {
      await chrome.storage.local.set({ 'kbeauty_history': valid });
    }
  } catch (e) {}
}

// Inspect active tab & communicate directly with content script
async function inspectActiveTab() {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');
  const currentVideoContent = document.getElementById('current-video-content');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url || !tab.url.includes('tiktok.com')) {
      if (statusDot) statusDot.className = 'status-dot offline';
      if (statusText) statusText.textContent = 'Chưa mở TikTok';
      if (currentVideoContent) {
        currentVideoContent.innerHTML = `
          <div class="empty-notice">
            <p>🛍️ <strong>Kbeautyhub sẵn sàng!</strong></p>
            <br/>
            <p>Hãy chuyển sang tab TikTok hoặc nhấn nút bên dưới để mở TikTok Web trên PC.</p>
            <br/>
            <button id="btn-goto-tiktok" class="btn btn-primary">Mở tiktok.com</button>
          </div>
        `;
        document.getElementById('btn-goto-tiktok')?.addEventListener('click', () => {
          chrome.tabs.create({ url: 'https://www.tiktok.com' });
        });
      }
      return;
    }

    if (statusDot) statusDot.className = 'status-dot online';
    if (statusText) statusText.textContent = 'Đang trên TikTok';

    const urlMatch = tab.url.match(/\/video\/(\d+)/);
    const urlVideoId = urlMatch ? urlMatch[1] : null;

    if (urlVideoId && urlVideoId === currentRenderedVideoId && currentRenderedVideoId !== null && document.querySelector('.popup-video-player')) {
      return;
    }

    // Send message to content script on that tab
    chrome.tabs.sendMessage(tab.id, { action: 'GET_ACTIVE_VIDEO', videoId: urlVideoId }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        // Fallback: If content script is not yet connected, check local storage or background for this videoId
        if (urlVideoId) {
          if (urlVideoId === currentRenderedVideoId && document.querySelector('.popup-video-player')) {
            return;
          }
          try {
            const stor = await chrome.storage.local.get('kbeauty_history');
            const history = stor.kbeauty_history || [];
            const saved = history.find(h => h.videoId === urlVideoId);
            if (saved) {
              currentRenderedVideoId = urlVideoId;
              if (saved.hasShopCart) {
                renderCurrentVideo(saved);
              } else {
                renderNoCartVideo(saved, tab.id);
              }
              return;
            }
          } catch (e) {}

          // Fallback via background TikWM resolution
          currentRenderedVideoId = urlVideoId;
          renderPendingVideo(urlVideoId, tab.id);
          chrome.runtime.sendMessage({ action: 'RESOLVE_TIKWM', videoId: urlVideoId }, (res) => {
            if (res && res.success && res.data) {
              const vd = res.data;
              if (vd.hasShopCart) {
                renderCurrentVideo(vd);
              } else {
                renderNoCartVideo(vd, tab.id);
              }
            }
          });
          return;
        }

        // Content script might not be injected yet or page is loading
        if (currentVideoContent) {
          currentVideoContent.innerHTML = `
            <div class="empty-notice">
              <p>⏳ Đang kết nối với trang TikTok...</p>
              <p style="margin-top:8px; font-size:11px; color:#25F4EE;">Nếu trang vừa tải xong, hãy F5 (làm mới) tab TikTok một lần để tiện ích hoạt động tối ưu.</p>
              <br/>
              <button id="btn-reload-tab" class="btn btn-secondary">🔄 Tải lại trang TikTok</button>
            </div>
          `;
          document.getElementById('btn-reload-tab')?.addEventListener('click', () => {
            chrome.tabs.reload(tab.id);
            window.close();
          });
        }
        return;
      }

      const { currentVideoId, videoData } = response;
      const targetVid = currentVideoId || urlVideoId;

      if (targetVid && targetVid === currentRenderedVideoId && currentRenderedVideoId !== null) {
        return;
      }
      currentRenderedVideoId = targetVid;

      if (videoData && videoData.hasShopCart) {
        renderCurrentVideo(videoData);
      } else if (videoData) {
        // Video found, but has NO shop cart
        renderNoCartVideo(videoData, tab.id);
      } else {
        // Not yet captured, offer instant scan
        renderPendingVideo(targetVid, tab.id);
      }
    });

  } catch (err) {
    console.error('[Kbeautyhub] Error inspecting tab:', err);
  }
}

// Render video WITH shop products or TikTok Shop tag
function renderCurrentVideo(item) {
  const container = document.getElementById('current-video-content');
  if (!container) return;

  if (currentRenderedVideoId === item.videoId && container.querySelector('.popup-video-player')) {
    return;
  }
  currentRenderedVideoId = item.videoId;

  if (!item.playAddr && item.videoId) {
    fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent('https://www.tiktok.com/@user/video/' + item.videoId)}`)
      .then(r => r.json())
      .then(j => {
        if (j.code === 0 && j.data?.play) {
          item.playAddr = j.data.play;
          renderCurrentVideo(item);
        }
      })
      .catch(() => {});
  }

  const prods = (item.products || []).filter(p => !((p.title || '').toLowerCase().includes('capcut')));
  const currentUrl = `https://www.tiktok.com/@${item.author?.uniqueId || 'user'}/video/${item.videoId}`;

  let prodsHtml = '';
  if (prods.length > 0) {
    prods.forEach((p, idx) => {
      const img = p.image || 'https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png';
      const link = p.webUrl || (p.productId ? `https://shop.tiktok.com/vn/pdp/${p.productId}?source=anchor` : currentUrl);
      const authorNick = item.author?.nickname || '';
      const authorUId = item.author?.uniqueId || '';
      const creatorShowcaseTitle = (authorNick && authorUId) 
        ? `${authorNick} (@${authorUId})` 
        : (authorUId ? `@${authorUId}` : 'TikTok Shop');

      const realShopName = (p.shopName && !p.shopName.includes('TikTok Shop (')) ? p.shopName : '';
      const sName = realShopName || (p.sellerId ? `Shop ID: ${p.sellerId}` : creatorShowcaseTitle);
      const sUrl = (realShopName && !realShopName.includes('(@')) 
        ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
        : (authorUId ? `https://www.tiktok.com/@${authorUId}` : link);

      prodsHtml += `
        <div class="product-card" data-idx="${idx}" data-pid="${p.productId || ''}">
          <!-- Top Product Info -->
          <div class="product-top-row">
            <img src="${img}" alt="${escapeHtml(p.title)}" class="product-thumb" onerror="this.src='https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png'" />
            <div class="product-top-info">
              <div class="product-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
              <div class="product-price-row">
                <span class="product-price">${escapeHtml(p.price || 'Xem trên shop')}</span>
                ${p.sales ? `<span class="product-sales-tag">Đã bán: ${escapeHtml(p.sales)}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Full Width Shop & Links Box -->
          <div class="popup-shop-box">
            <div class="popup-shop-header">
              <div class="shop-name-wrap">
                <span>🏪</span>
                <span class="shop-label" style="color:#8E93A6; font-size:10.5px;">Gian hàng:</span>
                <strong class="shop-name-text" title="${escapeHtml(sName)}">${escapeHtml(sName)}</strong>
              </div>
              ${p.sellerId ? `<span class="shop-id-pill" title="Mã định danh Seller ID">ID: ${escapeHtml(p.sellerId)}</span>` : ''}
            </div>

            <!-- Shop Link Row -->
            <div class="popup-link-row">
              <span class="popup-link-label">🌐 Link Gian Hàng / Tìm Shop:</span>
              <div class="popup-link-group">
                <input type="text" readonly class="popup-link-input popup-shop-input" value="${escapeHtml(sUrl)}" title="${escapeHtml(sUrl)}" />
                <button class="popup-copy-btn popup-shop-copy" data-copy="${escapeHtml(sUrl)}">📋 Copy</button>
                <a href="${sUrl}" target="_blank" rel="noopener noreferrer" class="popup-action-btn secondary popup-shop-btn">↗️ Xem Shop</a>
              </div>
            </div>

            <!-- Product Link Row -->
            <div class="popup-link-row">
              <span class="popup-link-label">🛍️ Link sản phẩm gắn giỏ hàng:</span>
              <div class="popup-link-group">
                <input type="text" readonly class="popup-link-input" value="${escapeHtml(link)}" title="${escapeHtml(link)}" />
                <button class="popup-copy-btn" data-copy="${escapeHtml(link)}">📋 Copy</button>
                <a href="${link}" target="_blank" rel="noopener noreferrer" class="popup-action-btn primary">↗️ Mở SP</a>
              </div>
            </div>

            <!-- Phía dưới link: Tên Shop bán sản phẩm -->
            <div class="popup-verified-shop-box">
              <div class="verified-shop-left">
                <span class="verified-shop-icon">🏪</span>
                <div class="verified-shop-info">
                  <span class="verified-shop-title">Tên Shop bán sản phẩm:</span>
                  <strong class="verified-shop-name" style="color:#FFFFFF; font-weight:800;">${escapeHtml(sName)}</strong>
                </div>
              </div>
              <a href="${sUrl}" target="_blank" rel="noopener noreferrer" class="verified-shop-btn">
                ↗️ Vào Shop
              </a>
            </div>
          </div>
        </div>
      `;
    });
  } else {
    const authorId = item.author?.uniqueId || 'creator';
    const creatorShowcaseUrl = `https://www.tiktok.com/@${authorId}`;
    const realShopName = item.shopName && !item.shopName.includes('TikTok Shop (') ? item.shopName : '';
    const shopSellerUrl = realShopName 
      ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
      : creatorShowcaseUrl;
    const shopDisplayName = realShopName || (item.sellerId ? `Shop ID: ${item.sellerId}` : `Shop của @${authorId}`);
    const productDirectUrl = `https://www.tiktok.com/@${authorId}/video/${item.videoId}?is_copy_url=1&is_from_webapp=1`;

    prodsHtml = `
      <div class="popup-fallback-card">
        <div class="fallback-header">
          <span style="font-size:16px;">🛒</span>
          <strong style="font-size: 12.5px; color: #FFB800;">Video có gắn giỏ hàng TikTok Shop!</strong>
        </div>
        <p class="fallback-desc">
          Dưới đây là chi tiết link Shop người bán, link gắn giỏ hàng và gian hàng của creator:
        </p>

        <!-- 1. Shop Seller Link -->
        <div class="popup-link-row">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
            <span class="popup-link-label" style="color:#FFB800; font-weight:700;">🏪 Link Shop bán sản phẩm (TikTok Shop):</span>
            <span style="font-size:9.5px; color:#8C92A4;">${escapeHtml(shopDisplayName)}</span>
          </div>
          <div class="popup-link-group">
            <input type="text" readonly class="popup-link-input" value="${escapeHtml(shopSellerUrl)}" title="${escapeHtml(shopSellerUrl)}" />
            <button class="popup-copy-btn" data-copy="${escapeHtml(shopSellerUrl)}">📋 Copy</button>
            <a href="${shopSellerUrl}" target="_blank" rel="noopener noreferrer" class="popup-action-btn secondary">↗️ Xem Shop</a>
          </div>
        </div>

        <!-- 2. Video Cart Link -->
        <div class="popup-link-row">
          <span class="popup-link-label" style="color:#25F4EE; font-weight:700;">🛍️ Link sản phẩm gắn giỏ hàng của video:</span>
          <div class="popup-link-group">
            <input type="text" readonly class="popup-link-input" value="${escapeHtml(productDirectUrl)}" title="${escapeHtml(productDirectUrl)}" />
            <button class="popup-copy-btn" data-copy="${escapeHtml(productDirectUrl)}">📋 Copy</button>
            <a href="${productDirectUrl}" target="_blank" rel="noopener noreferrer" class="popup-action-btn primary">↗️ Mở Giỏ Hàng</a>
          </div>
        </div>

        <!-- 3. Creator Showcase Link -->
        <div class="popup-link-row">
          <span class="popup-link-label">👤 Gian hàng Showcase của Creator (@${escapeHtml(authorId)}):</span>
          <div class="popup-link-group">
            <input type="text" readonly class="popup-link-input" value="${escapeHtml(creatorShowcaseUrl)}" title="${escapeHtml(creatorShowcaseUrl)}" />
            <button class="popup-copy-btn" data-copy="${escapeHtml(creatorShowcaseUrl)}">📋 Copy</button>
            <a href="${creatorShowcaseUrl}" target="_blank" rel="noopener noreferrer" class="popup-action-btn secondary">↗️ Xem Showcase</a>
          </div>
        </div>

        <!-- Phía dưới link: Tên Shop -->
        <div class="popup-verified-shop-box" style="margin-top:10px;">
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

        <div class="popup-qr-box">
          <span class="popup-qr-label">📱 Quét mã bằng điện thoại để mở thẳng giỏ hàng:</span>
          <div class="popup-qr-img-wrap">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(currentUrl)}" alt="QR Code" />
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="current-video-card">
      <div class="author-header">
        <img src="${item.author?.avatar || 'https://www.tiktok.com/favicon.ico'}" class="author-avatar" />
        <div class="author-info">
          <div class="author-name">@${escapeHtml(item.author?.uniqueId || 'user')}</div>
        </div>
        <div class="video-shop-tag">
          <span>🛍️ TikTok Shop</span>
        </div>
      </div>
      <div class="video-desc" title="${escapeHtml(item.desc || '')}">${escapeHtml(item.desc || 'Không có mô tả')}</div>
      ${videoDataActions(item)}
      ${prods.length > 0 ? `
        <div class="product-count-banner">
          <span>🛍️ Gắn ${prods.length} sản phẩm TikTok Shop:</span>
        </div>
      ` : ''}
      ${prodsHtml}
    </div>
  `;

  // Asynchronously resolve real shop name from PDP if not yet available
  prods.forEach((p, idx) => {
    if (p.productId && (!p.shopName || !p.isRealShop || p.shopName.includes('TikTok Shop (') || p.shopName.startsWith('Shop của @') || p.shopName.startsWith('Shop ID:'))) {
      chrome.runtime.sendMessage({ action: 'RESOLVE_PDP_SHOP_INFO', productId: p.productId }, (res) => {
        if (res && res.success && res.shopName) {
          p.shopName = res.shopName;
          p.isRealShop = true;
          p.shopUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(res.shopName)}`;
          const card = container.querySelectorAll('.product-card')[idx];
          if (card) {
            const nameEl = card.querySelector('.shop-name-text');
            if (nameEl) nameEl.textContent = res.shopName;
            const inputEl = card.querySelector('.popup-shop-input');
            if (inputEl) {
              inputEl.value = p.shopUrl;
              inputEl.title = p.shopUrl;
            }
            const linkBtn = card.querySelector('.popup-shop-btn');
            if (linkBtn) linkBtn.href = p.shopUrl;
            const copyBtn = card.querySelector('.popup-shop-copy');
            if (copyBtn) copyBtn.setAttribute('data-copy', p.shopUrl);
            const verifiedName = card.querySelector('.verified-shop-name');
            if (verifiedName) verifiedName.textContent = res.shopName;
            const verifiedBtn = card.querySelector('.verified-shop-btn');
            if (verifiedBtn) verifiedBtn.href = p.shopUrl;
          }
        }
      });
    }
  });

  // Attach copy listeners
  container.querySelectorAll('.popup-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-copy') || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✅ Đã chép!';
          btn.style.color = '#25F4EE';
          setTimeout(() => {
            btn.textContent = orig;
            btn.style.color = '';
          }, 1500);
        }).catch(() => {});
      }
    });
  });

  // Auto-select text on input click
  container.querySelectorAll('.popup-link-input').forEach(inp => {
    inp.addEventListener('click', () => {
      inp.select();
    });
  });

  document.getElementById('popup-unblock-btn')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const btn = document.getElementById('popup-unblock-btn');
      if (btn) btn.textContent = '⏳ Đang phát...';
      chrome.tabs.sendMessage(tab.id, { action: 'FORCE_UNBLOCK', videoId: item.videoId }, (res) => {
        if (btn) {
          btn.textContent = '✅ Đã phát lên trang chính';
          setTimeout(() => { btn.textContent = '🎬 Phát trên trang chính'; }, 2000);
        }
      });
    }
  });
}

function videoDataActions(item) {
  let playerHtml = '';
  if (item.playAddr) {
    playerHtml = `
      <div class="popup-video-box">
        <video src="${item.playAddr}" controls loop playsinline class="popup-video-player"></video>
      </div>
    `;
  }
  return `
    ${playerHtml}
    <div class="popup-action-row">
      ${item.playAddr ? `<a href="${item.playAddr}" target="_blank" download="tiktok_${item.videoId}.mp4" class="popup-btn-half btn-secondary">📥 Tải MP4</a>` : ''}
      <button id="popup-unblock-btn" class="popup-btn-half btn-primary">🎬 Phát trên trang chính</button>
    </div>
  `;
}

// Render video with NO shop cart
function renderNoCartVideo(item, tabId) {
  const container = document.getElementById('current-video-content');
  if (!container) return;

  container.innerHTML = `
    <div class="current-video-card">
      <div class="author-header">
        <img src="${item.author?.avatar || 'https://www.tiktok.com/favicon.ico'}" class="author-avatar" />
        <div class="author-info">
          <div class="author-name">@${escapeHtml(item.author?.uniqueId || 'user')}</div>
        </div>
      </div>
      <div class="video-desc">${escapeHtml(item.desc || 'Không có mô tả')}</div>
      <div style="background: rgba(239, 68, 68, 0.1); border: 1px dashed rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 12px; margin-top: 10px; text-align: center;">
        <p style="font-size: 13px; font-weight: 700; color: #F87171; margin-bottom: 4px;">
          ❌ Video này KHÔNG gắn giỏ hàng TikTok Shop
        </p>
        <p style="font-size: 11px; color: #9CA3AF; line-height: 1.4;">
          Người sáng tạo nội dung không gắn sản phẩm bán hàng trong video này (hoặc chỉ gắn hiệu ứng/nhạc).
        </p>
      </div>
      <button id="btn-force-rescan" class="btn btn-secondary" style="margin-top: 12px;">
        🔄 Quét kiểm tra lại video này
      </button>
      <button id="btn-goto-history" class="btn btn-outline" style="margin-top: 6px;">
        📦 Xem danh sách video có giỏ hàng đã lưu
      </button>
    </div>
  `;

  document.getElementById('btn-force-rescan')?.addEventListener('click', () => {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'FORCE_SCAN_VIDEO', videoId: item.videoId });
      const btn = document.getElementById('btn-force-rescan');
      if (btn) btn.textContent = '⏳ Đang quét...';
      setTimeout(inspectActiveTab, 1500);
    }
  });

  document.getElementById('btn-goto-history')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="tab-history"]')?.click();
  });
}

// Render pending video scan state
function renderPendingVideo(videoId, tabId) {
  const container = document.getElementById('current-video-content');
  if (!container) return;

  container.innerHTML = `
    <div class="empty-notice">
      <p style="font-size:13px; font-weight:700; color:#FFFFFF;">🔍 Video ID: ${videoId || 'Đang xác định'}</p>
      <p style="margin-top:6px; font-size:11px; color:#A1A1AA;">Nhấn nút dưới để quét xem video này có giỏ hàng không:</p>
      <br/>
      <button id="btn-manual-scan" class="btn btn-primary">⚡ Quét giỏ hàng video này ngay</button>
    </div>
  `;

  document.getElementById('btn-manual-scan')?.addEventListener('click', () => {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'FORCE_SCAN_VIDEO', videoId });
      const btn = document.getElementById('btn-manual-scan');
      if (btn) btn.textContent = '⏳ Đang phân tích gói tin...';
      setTimeout(inspectActiveTab, 2000);
    }
  });
}

// Load history into Tab 2 (Role-isolated & Multi-tenant)
let cachedHistory = [];
let currentTargetDeviceId = 'ALL';

async function loadHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;

  try {
    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'GET_USER_HISTORY', targetDeviceId: currentTargetDeviceId }, resolve);
    });

    if (!res || !res.success) return;

    currentUserRole = res.role || 'guest';
    const filterBar = document.getElementById('admin-history-filter-bar');
    const badgeCount = document.getElementById('admin-history-badge-count');

    if (currentUserRole === 'admin') {
      if (filterBar) filterBar.style.display = 'flex';
      const select = document.getElementById('admin-device-filter-select');
      if (select && select.dataset.populated !== 'true') {
        chrome.runtime.sendMessage({ action: 'GET_ADMIN_DATA' }, (adminRes) => {
          if (adminRes && adminRes.devices) {
            const currentVal = select.value || 'ALL';
            let optsHtml = `
              <option value="ALL">🌐 Toàn bộ khách (Tất cả thiết bị)</option>
              <option value="CURRENT">💻 Thiết bị này (Admin)</option>
            `;
            adminRes.devices.forEach(d => {
              if (d.deviceId !== adminRes.currentDeviceId) {
                optsHtml += `<option value="${escapeHtml(d.deviceId)}">👥 ${escapeHtml(d.deviceName || 'Máy khách')} (${escapeHtml(d.deviceId)})</option>`;
              }
            });
            select.innerHTML = optsHtml;
            select.value = currentVal;
            select.dataset.populated = 'true';
          }
        });
      }
    } else {
      if (filterBar) filterBar.style.display = 'none';
    }

    cachedHistory = (res.items || []).filter(item => {
      return item.products && item.products.some(p => !((p.title || '').toLowerCase().includes('capcut')));
    });

    if (badgeCount) {
      badgeCount.textContent = `${cachedHistory.length} mục`;
    }

    renderHistoryList(cachedHistory);
    updateHistoryCount();
  } catch (err) {
    console.error('[Kbeautyhub] Error loading history:', err);
  }
}

function renderHistoryList(items) {
  const container = document.getElementById('history-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-notice">
        Chưa có video giỏ hàng TikTok Shop nào được lưu.<br/>
        Hãy lướt các video review bán hàng trên TikTok để tiện ích tự động bắt sản phẩm!
      </div>
    `;
    return;
  }

  let html = '';
  items.forEach(item => {
    const prods = (item.products || []).filter(p => !((p.title || '').toLowerCase().includes('capcut')));
    if (prods.length === 0) return;

    const firstProd = prods[0] || {};
    const img = firstProd.image || item.cover || 'https://www.tiktok.com/favicon.ico';
    const prodCount = prods.length;
    const link = firstProd.webUrl || (firstProd.productId ? `https://shop.tiktok.com/vn/pdp/${firstProd.productId}?source=anchor` : '#');
    const realShopName = firstProd.shopName && !firstProd.shopName.includes('TikTok Shop (') ? firstProd.shopName : '';
    const sName = realShopName || (item.author?.uniqueId ? `Shop của @${item.author.uniqueId}` : 'TikTok Shop');
    const sUrl = realShopName
      ? `https://www.tiktok.com/search?q=${encodeURIComponent(realShopName)}`
      : (item.author?.uniqueId ? `https://www.tiktok.com/@${item.author.uniqueId}` : link);

    const timeStr = item.savedAt ? new Date(item.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : (item.savedAtStr || '');

    html += `
      <div class="current-video-card">
        <div class="author-header">
          <img src="${item.author?.avatar || 'https://www.tiktok.com/favicon.ico'}" class="author-avatar" />
          <div class="author-info">
            <div class="author-name">@${escapeHtml(item.author?.uniqueId || 'user')}</div>
            ${currentUserRole === 'admin' ? `
              <div class="history-item-device-badge ${item.userRole === 'admin' ? 'admin-tag' : ''}">
                👤 ${item.userRole === 'admin' ? '👑 Admin' : '👥 Khách'}: ${escapeHtml(item.deviceId || 'Chưa rõ')}
                ${timeStr ? `• 🕒 ${escapeHtml(timeStr)}` : ''}
              </div>
            ` : ''}
          </div>
          <span style="margin-left:auto; font-size:11px; color:#FFB800; font-weight:700;">${prodCount} SP</span>
        </div>
        <div class="product-card">
          <!-- Top Product Info -->
          <div class="product-top-row">
            <img src="${img}" alt="SP" class="product-thumb" onerror="this.src='https://sf-tb-sg.ibytedtos.com/obj/eden-sg/uhoh7uhb/shop_placeholder.png'" />
            <div class="product-top-info">
              <div class="product-title" title="${escapeHtml(firstProd.title || 'Sản phẩm TikTok Shop')}">${escapeHtml(firstProd.title || 'Sản phẩm TikTok Shop')}</div>
              <div class="product-price-row">
                <span class="product-price">${escapeHtml(firstProd.price || 'Xem trên shop')}</span>
                ${firstProd.sales ? `<span class="product-sales-tag">Đã bán: ${escapeHtml(firstProd.sales)}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Full Width Shop & Links Box -->
          <div class="popup-shop-box">
            <div class="popup-shop-header">
              <div class="shop-name-wrap">
                <span>🏪</span>
                <span class="shop-label" style="color:#8E93A6; font-size:10.5px;">Gian hàng:</span>
                <strong class="shop-name-text" title="${escapeHtml(sName)}">${escapeHtml(sName)}</strong>
              </div>
              ${firstProd.sellerId ? `<span class="shop-id-pill">ID: ${escapeHtml(firstProd.sellerId)}</span>` : ''}
            </div>

            <!-- Shop Link Row -->
            <div class="popup-link-row">
              <span class="popup-link-label">🌐 Link Gian Hàng / Tìm Shop:</span>
              <div class="popup-link-group">
                <input type="text" readonly class="popup-link-input" value="${escapeHtml(sUrl)}" title="${escapeHtml(sUrl)}" />
                <button class="popup-copy-btn" data-copy="${escapeHtml(sUrl)}">📋 Copy</button>
                <a href="${sUrl}" target="_blank" rel="noopener noreferrer" class="popup-action-btn secondary">↗️ Xem Shop</a>
              </div>
            </div>

            <!-- Product Link Row -->
            <div class="popup-link-row">
              <span class="popup-link-label">🛍️ Link sản phẩm gắn giỏ hàng:</span>
              <div class="popup-link-group">
                <input type="text" readonly class="popup-link-input" value="${escapeHtml(link)}" title="${escapeHtml(link)}" />
                <button class="popup-copy-btn" data-copy="${escapeHtml(link)}">📋 Copy</button>
                <a href="${link}" target="_blank" rel="noopener noreferrer" class="popup-action-btn primary">↗️ Mở SP</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Attach copy listeners
  container.querySelectorAll('.popup-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-copy') || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✅ Đã chép!';
          btn.style.color = '#25F4EE';
          setTimeout(() => {
            btn.textContent = orig;
            btn.style.color = '';
          }, 1500);
        }).catch(() => {});
      }
    });
  });

  // Auto-select text on input click
  container.querySelectorAll('.popup-link-input').forEach(inp => {
    inp.addEventListener('click', () => {
      inp.select();
    });
  });
}

function filterHistory(keyword) {
  if (!keyword) {
    renderHistoryList(cachedHistory);
    return;
  }

  const filtered = cachedHistory.filter(item => {
    const authorMatch = (item.author?.uniqueId || '').toLowerCase().includes(keyword);
    const descMatch = (item.desc || '').toLowerCase().includes(keyword);
    const prodMatch = (item.products || []).some(p => {
      const title = (p.title || '').toLowerCase();
      const shop = (p.shopName || '').toLowerCase();
      return title.includes(keyword) || shop.includes(keyword);
    });
    return authorMatch || descMatch || prodMatch;
  });

  renderHistoryList(filtered);
}

async function updateHistoryCount() {
  const countEl = document.getElementById('history-count');
  if (!countEl) return;
  const data = await chrome.storage.local.get('kbeauty_history');
  const count = (data.kbeauty_history || []).length;
  countEl.textContent = String(count);
}

// ==========================================
// EXCEL (.XLSX) GENERATION ENGINE (Pure JS OpenXML)
// 100% Native Excel Support, Auto-Filter, Column Widths, Frozen Header
// ==========================================

function buildZipBlob(files) {
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[i] = c >>> 0;
  }
  function calcCrc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = (c >>> 8) ^ crcTable[(c ^ bytes[i]) & 0xFF];
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const fileEntries = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = (typeof f.content === 'string') ? encoder.encode(f.content) : f.content;
    const crc = calcCrc32(dataBytes);
    const size = dataBytes.length;

    // 30 bytes local header
    const lh = new Uint8Array(30);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // Version 2.0
    dv.setUint16(6, 0, true);  // flags
    dv.setUint16(8, 0, true);  // compression = 0 (stored)
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);

    fileEntries.push({
      nameBytes,
      dataBytes,
      crc,
      size,
      offset,
      localHeader: lh
    });

    offset += 30 + nameBytes.length + size;
  }

  const centralParts = [];
  let centralDirSize = 0;

  for (const f of fileEntries) {
    const cd = new Uint8Array(46);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, f.crc, true);
    dv.setUint32(20, f.size, true);
    dv.setUint32(24, f.size, true);
    dv.setUint16(28, f.nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, f.offset, true);

    centralParts.push(cd);
    centralParts.push(f.nameBytes);
    centralDirSize += 46 + f.nameBytes.length;
  }

  // EOCD (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdDv = new DataView(eocd.buffer);
  eocdDv.setUint32(0, 0x06054b50, true);
  eocdDv.setUint16(4, 0, true);
  eocdDv.setUint16(6, 0, true);
  eocdDv.setUint16(8, fileEntries.length, true);
  eocdDv.setUint16(10, fileEntries.length, true);
  eocdDv.setUint32(12, centralDirSize, true);
  eocdDv.setUint32(16, offset, true);
  eocdDv.setUint16(20, 0, true);

  const finalParts = [];
  for (const f of fileEntries) {
    finalParts.push(f.localHeader);
    finalParts.push(f.nameBytes);
    finalParts.push(f.dataBytes);
  }
  finalParts.push(...centralParts);
  finalParts.push(eocd);

  return new Blob(finalParts, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function generateXlsxBlob(items) {
  const isAdmin = (currentUserRole === 'admin');
  const headers = isAdmin ? [
    'Mã Thiết Bị',
    'Tài Khoản',
    'Video ID',
    'Kênh TikTok',
    'Mô tả Video',
    'ID Sản Phẩm',
    'Tên Sản Phẩm',
    'Giá Bán',
    'Số Lượt Bán',
    'Tên Shop / Gian Hàng',
    'Seller ID',
    'Link Gian Hàng Shop',
    'Link Sản Phẩm Giỏ Hàng',
    'Thời Gian Quét'
  ] : [
    'Video ID',
    'Kênh TikTok',
    'Mô tả Video',
    'ID Sản Phẩm',
    'Tên Sản Phẩm',
    'Giá Bán',
    'Số Lượt Bán',
    'Tên Shop / Gian Hàng',
    'Seller ID',
    'Link Gian Hàng Shop',
    'Link Sản Phẩm Giỏ Hàng',
    'Thời Gian Quét'
  ];

  const dataRows = [];

  for (const item of items) {
    const videoId = item.videoId || '';
    const author = item.author?.uniqueId || '';
    const desc = item.desc || '';
    const time = item.savedAt ? new Date(item.savedAt).toLocaleString('vi-VN') : (item.savedAtStr || '');

    for (const prod of (item.products || [])) {
      if ((prod.title || '').toLowerCase().includes('capcut')) continue;

      const pId = prod.productId || '';
      const pTitle = prod.title || '';
      const pPrice = prod.price || '';
      const pSales = prod.sales || '';
      const pRealShopName = (prod.shopName && !prod.shopName.includes('TikTok Shop (')) ? prod.shopName : '';
      const pShopName = pRealShopName || (author ? `Shop của @${author}` : 'TikTok Shop');
      const pSellerId = prod.sellerId || '';
      const pShopUrl = pRealShopName 
        ? `https://www.tiktok.com/search?q=${encodeURIComponent(pRealShopName)}`
        : (author ? `https://www.tiktok.com/@${author}` : (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://www.tiktok.com'));
      const pUrl = prod.webUrl || (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : '');

      const baseRow = [
        videoId,
        author,
        desc,
        pId,
        pTitle,
        pPrice,
        pSales,
        pShopName,
        pSellerId,
        pShopUrl,
        pUrl,
        time
      ];

      if (isAdmin) {
        dataRows.push([
          item.deviceId || 'Chưa rõ',
          item.userRole === 'admin' ? 'Admin' : 'Khách',
          ...baseRow
        ]);
      } else {
        dataRows.push(baseRow);
      }
    }
  }

  function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colIndexToName(index) {
    let name = '';
    while (index >= 0) {
      name = String.fromCharCode((index % 26) + 65) + name;
      index = Math.floor(index / 26) - 1;
    }
    return name;
  }

  const totalRows = dataRows.length + 1;
  const lastColName = colIndexToName(headers.length - 1);

  // Build sheetData XML
  let sheetRowsXml = '';

  // Row 1: Header
  sheetRowsXml += `<row r="1" ht="28" customHeight="1">`;
  headers.forEach((h, colIdx) => {
    const cellRef = `${colIndexToName(colIdx)}1`;
    sheetRowsXml += `<c r="${cellRef}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(h)}</t></is></c>`;
  });
  sheetRowsXml += `</row>`;

  // Data rows
  dataRows.forEach((row, rowIdx) => {
    const rNum = rowIdx + 2;
    sheetRowsXml += `<row r="${rNum}" ht="20" customHeight="1">`;
    row.forEach((cellVal, colIdx) => {
      const cellRef = `${colIndexToName(colIdx)}${rNum}`;
      let styleId = 0;
      if (colIdx === 0 || colIdx === 3 || colIdx === 8 || colIdx === 11) {
        styleId = 2; // Centered
      } else if (colIdx === 9 || colIdx === 10) {
        styleId = 3; // Link
      } else if (colIdx === 5 || colIdx === 6) {
        styleId = 4; // Price / Sales
      }
      sheetRowsXml += `<c r="${cellRef}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${escapeXml(cellVal)}</t></is></c>`;
    });
    sheetRowsXml += `</row>`;
  });

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="38" customWidth="1"/>
    <col min="4" max="4" width="24" customWidth="1"/>
    <col min="5" max="5" width="46" customWidth="1"/>
    <col min="6" max="6" width="16" customWidth="1"/>
    <col min="7" max="7" width="15" customWidth="1"/>
    <col min="8" max="8" width="28" customWidth="1"/>
    <col min="9" max="9" width="24" customWidth="1"/>
    <col min="10" max="10" width="45" customWidth="1"/>
    <col min="11" max="11" width="45" customWidth="1"/>
    <col min="12" max="12" width="22" customWidth="1"/>
  </cols>
  <sheetData>${sheetRowsXml}</sheetData>
  <autoFilter ref="A1:${lastColName}${totalRows}"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><name val="Segoe UI"/><sz val="10"/><color rgb="FF000000"/></font>
    <font><b/><name val="Segoe UI"/><sz val="11"/><color rgb="FFFFFFFF"/></font>
    <font><u/><name val="Segoe UI"/><sz val="10"/><color rgb="FF0066CC"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF107C41"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFD0D5DD"/></left>
      <right style="thin"><color rgb="FFD0D5DD"/></right>
      <top style="thin"><color rgb="FFD0D5DD"/></top>
      <bottom style="thin"><color rgb="FFD0D5DD"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <!-- 0: Normal data cell -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFont="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 1: Header cell (Excel Green, bold white text) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyBorder="1" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <!-- 2: Centered data cell (IDs, Dates) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFont="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 3: Link data cell -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFont="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 4: Right-aligned price / sales -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyFont="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="TikTok Shop Kbeautyhub" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return buildZipBlob([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);
}

// Export native Excel (.xlsx) file with perfect column layout
async function exportExcel() {
  const res = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'GET_USER_HISTORY', targetDeviceId: currentTargetDeviceId }, resolve);
  });
  const items = (res && res.items) ? res.items : [];

  if (items.length === 0) {
    alert('Chưa có dữ liệu giỏ hàng để xuất!');
    return;
  }

  try {
    const blob = generateXlsxBlob(items);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kbeautyhub_tiktok_cart_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[Kbeautyhub] Error generating Excel:', err);
    alert('Lỗi tạo file Excel: ' + err.message);
  }
}

// Export CSV with Windows Excel separator directive (sep=,) & UTF-8 BOM
async function exportCSV() {
  const res = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'GET_USER_HISTORY', targetDeviceId: currentTargetDeviceId }, resolve);
  });
  const items = (res && res.items) ? res.items : [];

  if (items.length === 0) {
    alert('Chưa có dữ liệu giỏ hàng để xuất!');
    return;
  }

  const isAdmin = (currentUserRole === 'admin');
  const headers = isAdmin ? [
    '"Ma Thiet Bi"', '"Tai Khoan"', '"Video ID"', '"Kenh TikTok"', '"Mo ta Video"', '"ID San Pham"', '"Ten San Pham"', '"Gia Ban"', '"So Luot Ban"', '"Ten Shop / Gian Hang"', '"Seller ID"', '"Link Gian Hang Shop"', '"Link San Pham Gio Hang"', '"Thoi Gian Quet"'
  ] : [
    '"Video ID"', '"Kenh TikTok"', '"Mo ta Video"', '"ID San Pham"', '"Ten San Pham"', '"Gia Ban"', '"So Luot Ban"', '"Ten Shop / Gian Hang"', '"Seller ID"', '"Link Gian Hang Shop"', '"Link San Pham Gio Hang"', '"Thoi Gian Quet"'
  ];

  const rows = [headers];

  for (const item of items) {
    const videoId = item.videoId || '';
    const author = item.author?.uniqueId || '';
    const desc = (item.desc || '').replace(/"/g, '""');
    const time = item.savedAt ? new Date(item.savedAt).toLocaleString('vi-VN') : (item.savedAtStr || '');
    const devId = item.deviceId || 'Chưa rõ';
    const uRole = item.userRole === 'admin' ? 'Admin' : 'Khách';

    for (const prod of (item.products || [])) {
      if ((prod.title || '').toLowerCase().includes('capcut')) continue;

      const pId = prod.productId || '';
      const pTitle = (prod.title || '').replace(/"/g, '""');
      const pPrice = (prod.price || '').replace(/"/g, '""');
      const pSales = (prod.sales || '').replace(/"/g, '""');
      const pRealShopName = (prod.shopName && !prod.shopName.includes('TikTok Shop (')) ? prod.shopName : '';
      const pShopName = (pRealShopName || (author ? `Shop của @${author}` : 'TikTok Shop')).replace(/"/g, '""');
      const pSellerId = prod.sellerId || '';
      const pShopUrl = pRealShopName 
        ? `https://www.tiktok.com/search?q=${encodeURIComponent(pRealShopName)}`
        : (author ? `https://www.tiktok.com/@${author}` : (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : 'https://www.tiktok.com'));
      const pUrl = prod.webUrl || (pId ? `https://shop.tiktok.com/vn/pdp/${pId}?source=anchor` : '');

      const baseVals = [
        `"${videoId}"`,
        `"${author}"`,
        `"${desc}"`,
        `"${pId}"`,
        `"${pTitle}"`,
        `"${pPrice}"`,
        `"${pSales}"`,
        `"${pShopName}"`,
        `"${pSellerId}"`,
        `"${pShopUrl}"`,
        `"${pUrl}"`,
        `"${time}"`
      ];

      if (isAdmin) {
        rows.push([`"${devId}"`, `"${uRole}"`, ...baseVals]);
      } else {
        rows.push(baseVals);
      }
    }
  }

  // Prepend \uFEFF BOM and sep=, directive so Excel on Windows recognizes comma column separators
  const csvContent = '\uFEFFsep=,\r\n' + rows.map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kbeautyhub_tiktok_cart_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export JSON
async function exportJSON() {
  const data = await chrome.storage.local.get('kbeauty_history');
  const items = data.kbeauty_history || [];

  if (items.length === 0) {
    alert('Chưa có dữ liệu giỏ hàng để xuất!');
    return;
  }

  const filtered = items.filter(it => it.products && it.products.some(p => !((p.title || '').toLowerCase().includes('capcut'))));

  const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kbeautyhub_tiktok_cart_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Clear History
async function clearHistory() {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử giỏ hàng đã lưu?')) {
    await chrome.storage.local.set({ 'kbeauty_history': [] });
    await loadHistory();
    alert('Đã dọn dẹp lịch sử giỏ hàng!');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Activation & Password Security Functions
// ============================================================
function applyRolePermissions(role) {
  currentUserRole = role || 'guest';
  const adminTabBtn = document.querySelector('[data-tab="tab-admin"]');
  const adminFilterBar = document.getElementById('admin-history-filter-bar');

  if (adminTabBtn) {
    if (currentUserRole === 'admin') {
      adminTabBtn.innerHTML = '<span>👑</span> Admin';
      adminTabBtn.title = 'Bảng quản trị Admin (Đã xác thực)';
    } else {
      adminTabBtn.innerHTML = '<span>🔒</span> Admin';
      adminTabBtn.title = 'Nhấn để nhập mật khẩu Admin (kbeautyhub)';
    }
    adminTabBtn.style.display = 'inline-flex';
  }

  if (adminFilterBar) {
    adminFilterBar.style.display = (currentUserRole === 'admin') ? 'flex' : 'none';
  }
}

async function initActivationState() {
  const store = await chrome.storage.local.get(['kbeauty_is_unlocked', 'kbeauty_user_role']);
  const isUnlocked = !!store.kbeauty_is_unlocked;
  const actScreen = document.getElementById('activation-screen');
  const mainApp = document.getElementById('main-app-container');

  if (!isUnlocked) {
    if (actScreen) actScreen.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';

    const input = document.getElementById('activation-password-input');
    const submitBtn = document.getElementById('btn-submit-activation');
    const toggleVis = document.getElementById('btn-toggle-pwd-vis');
    const errorEl = document.getElementById('activation-error');

    if (toggleVis && input) {
      toggleVis.onclick = () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        toggleVis.textContent = input.type === 'password' ? '👁️' : '🙈';
      };
    }

    const doSubmit = () => {
      const pass = (input?.value || '').trim();
      if (!pass) {
        if (errorEl) {
          errorEl.textContent = 'Vui lòng nhập mật khẩu kích hoạt!';
          errorEl.style.display = 'block';
        }
        return;
      }

      chrome.runtime.sendMessage({ action: 'VERIFY_ACTIVATION_PASSWORD', password: pass }, (res) => {
        if (res && res.success) {
          if (actScreen) actScreen.style.display = 'none';
          if (mainApp) mainApp.style.display = 'block';
          applyRolePermissions(res.role || 'guest');
          inspectActiveTab();
          if (res.role === 'admin') {
            loadAdminData();
          }
        } else {
          if (errorEl) {
            errorEl.textContent = res?.error || 'Mật khẩu kích hoạt không chính xác!';
            errorEl.style.display = 'block';
          }
        }
      });
    };

    if (submitBtn) submitBtn.onclick = doSubmit;
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === 'Enter') doSubmit();
      };
    }
  } else {
    if (actScreen) actScreen.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';
    applyRolePermissions(store.kbeauty_user_role || 'guest');
  }
}

// Master ON/OFF Switch
async function initMasterToggle() {
  const store = await chrome.storage.local.get('kbeauty_master_enabled');
  const enabled = store.kbeauty_master_enabled !== false;
  const toggle = document.getElementById('master-toggle');
  const label = document.getElementById('master-status-label');

  if (toggle) {
    toggle.checked = enabled;
  }
  if (label) {
    label.textContent = enabled ? 'BẬT' : 'TẮT';
    label.className = `master-status-badge ${enabled ? 'on' : 'off'}`;
  }

  if (toggle) {
    toggle.addEventListener('change', async () => {
      const isChecked = toggle.checked;
      if (label) {
        label.textContent = isChecked ? 'BẬT' : 'TẮT';
        label.className = `master-status-badge ${isChecked ? 'on' : 'off'}`;
      }

      // 1. Immediately persist directly to local storage
      await chrome.storage.local.set({ kbeauty_master_enabled: isChecked });

      // 2. Notify background service worker to update badge & manage service
      chrome.runtime.sendMessage({ action: 'SET_MASTER_ENABLED', enabled: isChecked }).catch(() => {});

      // 3. Immediately broadcast to all TikTok tabs directly
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.tiktok.com/*' });
        tabs.forEach(t => {
          chrome.tabs.sendMessage(t.id, { action: 'MASTER_TOGGLE_CHANGED', enabled: isChecked }).catch(() => {});
        });
      } catch (e) {}
    });
  }
}

// ============================================================
// Admin & Device Management Functions
// ============================================================
function loadAdminData() {
  try {
    chrome.runtime.sendMessage({ action: 'GET_ADMIN_DATA' }, (res) => {
      try {
        if (!res || !res.success) {
          console.warn('[Kbeautyhub] GET_ADMIN_DATA response empty or not success:', res);
          return;
        }

        const currentDeviceId = res.currentDeviceId || 'KBH-PC-DEFAULT';
        const devices = Array.isArray(res.devices) ? res.devices : [];
        const analytics = res.analytics || { totalWatched: 0, shopVideosCount: 0, shopRate: 0, totalShopsDiscovered: 0, topShops: [] };
        const guestPassword = res.guestPassword || 'guest2026';
        const cloudUrl = res.cloudUrl || '';
        const cloudSyncStatus = res.cloudSyncStatus || 'offline';
        const lastCloudSyncTime = res.lastCloudSyncTime || 0;

        // Guest password display
        const guestPassEl = document.getElementById('admin-guest-pass-display');
        if (guestPassEl) {
          guestPassEl.textContent = guestPassword;
        }

        // Cloud Sync UI Status
        const cloudInput = document.getElementById('cloud-api-url');
        if (cloudInput && !cloudInput.matches(':focus')) {
          cloudInput.value = cloudUrl;
        }

        const cloudPill = document.getElementById('cloud-sync-status-pill');
        if (cloudPill) {
          if (cloudSyncStatus === 'connected') {
            cloudPill.textContent = '🟢 Đã kết nối Cloud';
            cloudPill.className = 'status-pill online';
          } else if (cloudSyncStatus === 'error') {
            cloudPill.textContent = '🔴 Lỗi kết nối URL';
            cloudPill.className = 'status-pill offline';
          } else {
            cloudPill.textContent = '⚪ Chế độ cục bộ';
            cloudPill.className = 'status-pill offline';
          }
        }

        const remoteDevs = devices.filter(d => d && d.source === 'cloud');
        const cloudStatDevs = document.getElementById('cloud-stat-devices');
        const cloudStatHist = document.getElementById('cloud-stat-history');
        const cloudStatSync = document.getElementById('cloud-stat-last-sync');

        if (cloudStatDevs) cloudStatDevs.textContent = `${remoteDevs.length} máy`;
        if (cloudStatHist) cloudStatHist.textContent = `${analytics.totalWatched || 0} video`;
        if (cloudStatSync) {
          cloudStatSync.textContent = lastCloudSyncTime 
            ? new Date(lastCloudSyncTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
            : 'Chưa có';
        }

        // Current Device
        const curDev = devices.find(d => d && d.deviceId === currentDeviceId) || devices[0] || {
          deviceId: currentDeviceId,
          deviceName: 'Windows PC • Chrome',
          status: 'online'
        };
        const devIdEl = document.getElementById('admin-device-id');
        const devNameEl = document.getElementById('admin-device-name');
        const devScreenEl = document.getElementById('admin-device-screen');
        const devWatchingEl = document.getElementById('admin-device-watching');
        const devPill = document.getElementById('current-device-status-pill');

        if (devIdEl) devIdEl.textContent = currentDeviceId;
        if (devNameEl) devNameEl.textContent = curDev.deviceName || 'Windows PC • Chrome';
        if (devScreenEl) devScreenEl.textContent = `${window.screen?.width || 1920}x${window.screen?.height || 1080}`;
        if (devPill) {
          devPill.textContent = '🟢 Trực tuyến (Thời gian thực)';
          devPill.className = 'status-pill online';
        }

        if (devWatchingEl) {
          if (curDev && curDev.currentWatching && curDev.currentWatching.author) {
            const w = curDev.currentWatching;
            devWatchingEl.textContent = `@${w.author}${w.shopName ? ` • Shop: ${w.shopName}` : (w.hasShopCart ? ' • Có giỏ hàng' : '')}`;
          } else {
            devWatchingEl.textContent = 'Đang theo dõi tab TikTok...';
          }
        }

        // Metrics
        const totalEl = document.getElementById('stat-total-watched');
        const shopEl = document.getElementById('stat-shop-videos');
        const rateEl = document.getElementById('stat-shop-rate');
        const countEl = document.getElementById('stat-shops-count');

        if (totalEl) totalEl.textContent = analytics.totalWatched || 0;
        if (shopEl) shopEl.textContent = analytics.shopVideosCount || 0;
        if (rateEl) rateEl.textContent = `${analytics.shopRate || 0}%`;
        if (countEl) countEl.textContent = analytics.totalShopsDiscovered || 0;

        // Top Shops
        const topList = document.getElementById('top-shops-list');
        if (topList) {
          if (analytics.topShops && analytics.topShops.length > 0) {
            topList.innerHTML = analytics.topShops.map((s, idx) => `
              <div class="top-shop-item">
                <span class="top-shop-name">${idx + 1}. 🏪 ${escapeHtml(s.name)}</span>
                <span class="top-shop-count">${s.count} lần</span>
              </div>
            `).join('');
          } else {
            topList.innerHTML = `<div class="empty-hint" style="color:#6B7280; font-size:11px; padding:4px;">Chưa có dữ liệu shop</div>`;
          }
        }

        // Devices List
        const devListEl = document.getElementById('admin-devices-list');
        if (devListEl) {
          if (devices.length > 0) {
            devListEl.innerHTML = devices.map(d => {
              if (!d) return '';
              const isCurrent = (d.deviceId === currentDeviceId);
              const isOnline = (d.status === 'online' || d.status === 'Online');
              const isCloud = (d.source === 'cloud');
              const lastStr = d.lastActive ? new Date(d.lastActive).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (d.lastActiveStr || 'Vừa xong');
              const roleBadge = d.role === 'admin'
                ? '<span class="status-pill admin-badge" style="background:rgba(255,184,0,0.15);color:#FFB800;border:1px solid rgba(255,184,0,0.3);font-size:10px;padding:2px 6px;">👑 Admin</span>'
                : '<span class="status-pill guest-badge" style="background:rgba(37,244,238,0.12);color:#25F4EE;border:1px solid rgba(37,244,238,0.3);font-size:10px;padding:2px 6px;">👥 Khách</span>';

              return `
                <div class="device-item-card">
                  <div class="device-item-info">
                    <div class="device-item-name">
                      <span>${escapeHtml(d.deviceName || 'Thiết bị PC')}</span>
                      ${roleBadge}
                      ${isCloud ? '<span style="font-size:10px; color:#A78BFA; background:rgba(167,139,250,0.12); padding:1px 5px; border-radius:4px;">☁️ Từ xa</span>' : ''}
                      ${isCurrent ? '<span style="font-size:10px; color:#25F4EE; background:rgba(37,244,238,0.12); padding:1px 5px; border-radius:4px;">Máy này</span>' : ''}
                    </div>
                    <span class="device-item-id">ID: ${escapeHtml(d.deviceId || '')}</span>
                    <span class="device-item-last">Hoạt động: ${lastStr} ${d.watching ? `• Đang xem: ${escapeHtml(d.watching)}` : ''}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span class="status-pill ${isOnline ? 'online' : 'offline'}">${isOnline ? '🟢 Online' : '⚪ Offline'}</span>
                    ${!isCurrent ? `<button class="btn btn-danger btn-revoke-dev" data-devid="${escapeHtml(d.deviceId || '')}" style="padding:3px 7px; font-size:10px;">Xóa</button>` : ''}
                  </div>
                </div>
              `;
            }).join('');

            // Attach revoke listeners
            devListEl.querySelectorAll('.btn-revoke-dev').forEach(b => {
              b.addEventListener('click', () => {
                const devId = b.getAttribute('data-devid');
                if (devId && confirm(`Bạn có chắc muốn xóa thiết bị [${devId}] khỏi danh sách quản lý?`)) {
                  chrome.runtime.sendMessage({ action: 'REVOKE_DEVICE', deviceId: devId }, () => {
                    loadAdminData();
                  });
                }
              });
            });
          } else {
            devListEl.innerHTML = `<div class="empty-hint" style="color:#6B7280; font-size:11px; padding:8px;">Chưa có thiết bị nào khác</div>`;
          }
        }
      } catch (err) {
        console.error('[Kbeautyhub] Error processing admin data:', err);
      }
    });
  } catch (e) {
    console.error('[Kbeautyhub] loadAdminData failed:', e);
  }
}

function handleLockExtension() {
  if (confirm('Bạn có chắc chắn muốn khóa tiện ích trên máy này? Bạn sẽ cần nhập mật khẩu để mở khóa lại.')) {
    chrome.runtime.sendMessage({ action: 'LOCK_EXTENSION' }, () => {
      initActivationState();
    });
  }
}

function handleChangeAdminPassword() {
  const oldPassword = prompt('Vui lòng nhập mật khẩu Admin hiện tại:');
  if (!oldPassword) return;

  const newPassword = prompt('Nhập mật khẩu Admin mới (ít nhất 4 ký tự):');
  if (!newPassword || newPassword.trim().length < 4) {
    alert('Mật khẩu Admin mới không hợp lệ! Vui lòng nhập ít nhất 4 ký tự.');
    return;
  }

  chrome.runtime.sendMessage({ action: 'CHANGE_ACCESS_PASSWORD', oldPassword: oldPassword.trim(), newPassword: newPassword.trim() }, (res) => {
    if (res && res.success) {
      alert('✅ Đổi mật khẩu Admin thành công! Hãy ghi nhớ mật khẩu mới.');
      loadAdminData();
    } else {
      alert('❌ Lỗi: ' + (res?.error || 'Không thể đổi mật khẩu Admin.'));
    }
  });
}

function handleChangeGuestPassword() {
  const adminPassword = prompt('Nhập mật khẩu Admin để xác nhận quyền thay đổi mật khẩu Khách:');
  if (!adminPassword) return;

  const newGuestPassword = prompt('Nhập mật khẩu Khách mới (dành cho khách/nhân viên đăng nhập):');
  if (!newGuestPassword || newGuestPassword.trim().length < 3) {
    alert('Mật khẩu Khách mới không hợp lệ! Vui lòng nhập ít nhất 3 ký tự.');
    return;
  }

  chrome.runtime.sendMessage({ action: 'CHANGE_GUEST_PASSWORD', adminPassword: adminPassword.trim(), newGuestPassword: newGuestPassword.trim() }, (res) => {
    if (res && res.success) {
      alert(`✅ Đổi mật khẩu Khách thành công!\nMật khẩu mới là: ${newGuestPassword.trim()}\n(Mật khẩu đã được tự động đồng bộ lên Cloud)`);
      loadAdminData();
    } else {
      alert('❌ Lỗi: ' + (res?.error || 'Không thể đổi mật khẩu Khách.'));
    }
  });
}

// ============================================================
// Cloud Synchronization & Remote Update Handlers
// ============================================================
function handleSaveCloudUrl() {
  const input = document.getElementById('cloud-api-url');
  const url = (input?.value || '').trim();

  if (url && !url.startsWith('https://script.google.com/macros/s/')) {
    if (!confirm('URL bạn nhập có vẻ không phải là Google Apps Script Web App (/exec). Bạn có chắc chắn muốn tiếp tục?')) {
      return;
    }
  }

  const btn = document.getElementById('btn-save-cloud-url');
  if (btn) {
    btn.textContent = '⏳ Đang kết nối...';
    btn.disabled = true;
  }

  chrome.runtime.sendMessage({ action: 'SAVE_CLOUD_URL', cloudUrl: url }, (res) => {
    if (btn) {
      btn.textContent = '💾 Lưu & Kết nối';
      btn.disabled = false;
    }
    if (res && res.success) {
      alert('✅ ' + (res.message || 'Cập nhật Cloud Sync thành công!'));
      loadAdminData();
      loadHistory();
    } else {
      alert('❌ Lỗi kết nối Cloud: ' + (res?.message || 'Không thể kết nối.'));
    }
  });
}

function handleForceCloudSync() {
  const btn = document.getElementById('btn-force-cloud-sync');
  if (btn) {
    btn.textContent = '⏳ Đang đồng bộ...';
    btn.disabled = true;
  }

  chrome.runtime.sendMessage({ action: 'FORCE_CLOUD_SYNC' }, (res) => {
    if (btn) {
      btn.textContent = '🔄 Đồng bộ ngay';
      btn.disabled = false;
    }
    if (res && res.success) {
      alert('✅ Đã đồng bộ toàn bộ dữ liệu khách từ xa thành công!');
      loadAdminData();
      loadHistory();
    } else {
      alert('⚠️ Không thể đồng bộ. Hãy kiểm tra URL Google Apps Script trong tab Admin.');
    }
  });
}

function handleOpenGoogleSheet() {
  chrome.storage.local.get('kbeauty_cloud_url', (store) => {
    const url = store.kbeauty_cloud_url || '';
    if (url) {
      window.open('https://docs.google.com/spreadsheets/', '_blank');
    } else {
      alert('Vui lòng kết nối Google Apps Script Web App trước!');
    }
  });
}

function handleCopyGasCode() {
  const gasCode = `/**
 * KBEAUTYHUB TIKTOK VIEW - GOOGLE APPS SCRIPT CLOUD BACKEND (v1.9.4)
 * Chạy 24/7 trên Google Cloud miễn phí 100%
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'check_updates';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsSetup(ss);

  if (action === 'get_admin_data') {
    return responseJSON({
      success: true,
      devices: getDevicesList(ss),
      history: getHistoryList(ss),
      config: getConfigMap(ss)
    });
  }

  var config = getConfigMap(ss);
  return responseJSON({
    success: true,
    latest_version: config.latest_version || '1.9.5',
    download_url: config.download_url || '',
    guest_password: config.guest_password || 'guest2026',
    system_notice: config.system_notice || 'Kbeautyhub hoạt động ổn định.'
  });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || 'sync_telemetry';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsSetup(ss);

    if (action === 'sync_telemetry' || action === 'sync_device') {
      upsertDevice(ss, payload);
      var config = getConfigMap(ss);
      return responseJSON({ success: true, guest_password: config.guest_password || 'guest2026', latest_version: config.latest_version || '1.9.5' });
    }
    if (action === 'sync_history') {
      appendHistory(ss, payload);
      return responseJSON({ success: true, message: 'History saved' });
    }
    if (action === 'update_guest_password') {
      updateConfigKey(ss, 'guest_password', payload.newGuestPassword);
      return responseJSON({ success: true });
    }
    return responseJSON({ success: true });
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

function ensureSheetsSetup(ss) {
  if (!ss.getSheetByName('Devices')) {
    var s = ss.insertSheet('Devices');
    s.appendRow(['Mã Thiết Bị', 'Tên Máy / Hệ Điều Hành', 'Phân Quyền', 'Trạng Thái', 'Hoạt Động Cuối', 'Video Đang Xem', 'Ngày Đăng Ký']);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName('History')) {
    var s = ss.insertSheet('History');
    s.appendRow(['Thời Gian', 'Mã Thiết Bị', 'Phân Quyền', 'ID Video', 'Kênh Creator', 'Tên Gian Hàng', 'Số SP', 'Tên Sản Phẩm', 'Giá Bán', 'Link Sản Phẩm', 'Link Video']);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName('Config')) {
    var s = ss.insertSheet('Config');
    s.appendRow(['Cài Đặt', 'Giá Trị', 'Ghi Chú']);
    s.appendRow(['latest_version', '1.9.5', 'Phiên bản mới nhất']);
    s.appendRow(['guest_password', 'guest2026', 'Mật khẩu khách']);
    s.setFrozenRows(1);
  }
}

function upsertDevice(ss, data) {
  var sheet = ss.getSheetByName('Devices');
  if (!sheet) return;
  var deviceId = data.deviceId || 'UNKNOWN';
  var rows = sheet.getDataRange().getValues();
  var found = -1;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] == deviceId) { found = i + 1; break; }
  }
  var nowStr = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
  var watch = (data.currentWatching && data.currentWatching.author) ? ('@' + data.currentWatching.author + (data.currentWatching.shopName ? ' • ' + data.currentWatching.shopName : '')) : '';
  if (found > 0) {
    sheet.getRange(found, 2).setValue(data.deviceName || rows[found-1][1]);
    sheet.getRange(found, 3).setValue(data.role || rows[found-1][2]);
    sheet.getRange(found, 4).setValue('Online');
    sheet.getRange(found, 5).setValue(nowStr);
    if (watch) sheet.getRange(found, 6).setValue(watch);
  } else {
    sheet.appendRow([deviceId, data.deviceName || 'Windows PC', data.role || 'guest', 'Online', nowStr, watch, nowStr]);
  }
}

function appendHistory(ss, data) {
  var sheet = ss.getSheetByName('History');
  if (!sheet) return;
  var entry = data.entry || data;
  var nowStr = Utilities.formatDate(new Date(entry.savedAt || Date.now()), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
  var prods = entry.products || [];
  var first = prods[0] || {};
  sheet.appendRow([
    nowStr,
    entry.deviceId || 'UNKNOWN',
    entry.userRole || 'guest',
    entry.videoId || '',
    entry.author?.uniqueId ? '@' + entry.author.uniqueId : '',
    entry.shopName || first.shopName || '',
    prods.length,
    first.title || '',
    first.price || '',
    first.webUrl || (first.productId ? 'https://shop.tiktok.com/vn/pdp/' + first.productId : ''),
    entry.videoId ? 'https://www.tiktok.com/@' + (entry.author?.uniqueId || 'user') + '/video/' + entry.videoId : ''
  ]);
}

function getDevicesList(ss) {
  var s = ss.getSheetByName('Devices');
  if (!s) return [];
  var rows = s.getDataRange().getValues(), list = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) list.push({ deviceId: rows[i][0], deviceName: rows[i][1], role: rows[i][2], status: rows[i][3], lastActiveStr: rows[i][4], watching: rows[i][5] });
  }
  return list;
}

function getHistoryList(ss) {
  var s = ss.getSheetByName('History');
  if (!s) return [];
  var rows = s.getDataRange().getValues(), list = [];
  var start = Math.max(1, rows.length - 300);
  for (var i = rows.length - 1; i >= start; i--) {
    var r = rows[i];
    if (!r[3]) continue;
    list.push({
      savedAtStr: r[0],
      deviceId: r[1],
      userRole: r[2],
      videoId: r[3],
      author: { uniqueId: String(r[4]).replace('@', '') },
      shopName: r[5],
      products: [{ title: r[7], price: r[8], webUrl: r[9] }]
    });
  }
  return list;
}

function getConfigMap(ss) {
  var s = ss.getSheetByName('Config');
  if (!s) return {};
  var rows = s.getDataRange().getValues(), cfg = {};
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) cfg[String(rows[i][0]).trim()] = String(rows[i][1] || '').trim();
  }
  return cfg;
}

function updateConfigKey(ss, key, val) {
  var s = ss.getSheetByName('Config');
  if (!s) return;
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] == key) { s.getRange(i + 1, 2).setValue(val); return; }
  }
  s.appendRow([key, val, 'Auto update']);
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;

  navigator.clipboard.writeText(gasCode).then(() => {
    alert('📋 ĐÃ SAO CHÉP MÃ GOOGLE APPS SCRIPT MẪU!\n\nCách triển khai trong 2 phút:\n1. Mở trang Google Sheet mới (https://sheets.new)\n2. Vào Tiện ích mở rộng -> Apps Script\n3. Dán mã này vào và Lưu (Ctrl+S)\n4. Bấm Triển khai (Deploy) -> Ứng dụng web mới -> Quyền truy cập: "Bất kỳ ai" (Anyone)\n5. Sao chép URL dán vào ô "URL Google Apps Script" ở trên!');
  }).catch(() => {
    alert('Vui lòng mở file google_apps_script.js trong thư mục tiện ích để copy mã.');
  });
}

function checkUpdateBanner() {
  chrome.storage.local.get('kbeauty_update_info', (store) => {
    const info = store.kbeauty_update_info;
    const banner = document.getElementById('update-notification-banner');
    if (!banner) return;

    if (info && info.available) {
      banner.style.display = 'flex';
      const textEl = document.getElementById('update-banner-text');
      const actionBtn = document.getElementById('btn-download-update');
      const dismissBtn = document.getElementById('btn-dismiss-update');

      if (textEl) textEl.textContent = `🚀 Bản mới v${info.latestVersion}: ${info.notice || 'Đã có bản cập nhật!'}`;
      if (actionBtn && info.downloadUrl) {
        actionBtn.href = info.downloadUrl;
      }

      if (dismissBtn) {
        dismissBtn.onclick = () => {
          banner.style.display = 'none';
        };
      }
    } else {
      banner.style.display = 'none';
    }
  });
}

