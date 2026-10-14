/**
 * Kbeautyhub - TikTok View v1.9.5
 * Background Service Worker (Manifest V3)
 * Handles installation lifecycle, multi-tenant history isolation,
 * online cloud synchronization (Google Apps Script / Sheets), remote auto-updates,
 * password verification, device management, and real-time heartbeats.
 * Developed by Son Designer
 */

// Generate a unique 8-character device identifier
function generateDeviceId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `KBH-PC-${id}`;
}

// Detect client OS and browser from User Agent
function detectDeviceEnvironment() {
  const ua = navigator.userAgent || '';
  let os = 'Windows PC';
  if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux PC';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS Device';
  else if (ua.includes('Android')) os = 'Android';

  let browser = 'Chrome';
  if (ua.includes('Edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('Brave')) browser = 'Brave';
  else if (ua.includes('Firefox')) browser = 'Firefox';

  return `${os} • ${browser}`;
}

// ============================================================
// Cloud Synchronization & Remote Update Engine
// Free 24/7 backend powered by Google Apps Script / Google Sheets
// ============================================================
let _lastCloudSyncTime = 0;
let _lastCloudSyncStatus = 'offline';

async function getCloudUrl() {
  try {
    const store = await chrome.storage.local.get('kbeauty_cloud_url');
    return (store.kbeauty_cloud_url || '').trim();
  } catch (e) {
    return '';
  }
}

async function syncTelemetryToCloud(devData) {
  const cloudUrl = await getCloudUrl();
  if (!cloudUrl) return;

  try {
    const store = await chrome.storage.local.get(['kbeauty_device_id', 'kbeauty_user_role']);
    const payload = {
      action: 'sync_telemetry',
      deviceId: store.kbeauty_device_id || 'UNKNOWN',
      deviceName: devData?.deviceName || detectDeviceEnvironment(),
      role: store.kbeauty_user_role || 'guest',
      currentWatching: devData?.currentWatching || null,
      timestamp: Date.now()
    };

    const res = await fetch(cloudUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      _lastCloudSyncTime = Date.now();
      _lastCloudSyncStatus = 'connected';

      // Remote guest password auto-update
      if (data.guest_password) {
        await chrome.storage.local.set({ kbeauty_guest_password: data.guest_password });
      }
      // Check for new version release
      if (data.latest_version) {
        checkVersionDiff(data.latest_version, data.download_url);
      }
    }
  } catch (err) {
    _lastCloudSyncStatus = 'error';
    console.warn('[Kbeautyhub Cloud] syncTelemetryToCloud error:', err);
  }
}

async function syncHistoryToCloud(entry) {
  const cloudUrl = await getCloudUrl();
  if (!cloudUrl || !entry) return;

  try {
    const payload = {
      action: 'sync_history',
      entry: entry,
      timestamp: Date.now()
    };

    await fetch(cloudUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    _lastCloudSyncTime = Date.now();
  } catch (err) {
    console.warn('[Kbeautyhub Cloud] syncHistoryToCloud error:', err);
  }
}

async function updateCloudGuestPassword(newGuestPassword) {
  const cloudUrl = await getCloudUrl();
  if (!cloudUrl) return;

  try {
    await fetch(cloudUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'update_guest_password',
        newGuestPassword: newGuestPassword
      })
    });
  } catch (e) {}
}

async function fetchCloudAdminData() {
  const cloudUrl = await getCloudUrl();
  if (!cloudUrl) return null;

  try {
    const fetchUrl = `${cloudUrl}${cloudUrl.includes('?') ? '&' : '?'}action=get_admin_data&t=${Date.now()}`;
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _lastCloudSyncTime = Date.now();
    _lastCloudSyncStatus = 'connected';

    // Cache remote devices and remote history into local storage for offline access
    if (data.devices) {
      await chrome.storage.local.set({ kbeauty_cloud_remote_devices: data.devices });
    }
    if (data.history) {
      await chrome.storage.local.set({ kbeauty_cloud_remote_history: data.history });
    }
    if (data.config && data.config.guest_password) {
      await chrome.storage.local.set({ kbeauty_guest_password: data.config.guest_password });
    }
    if (data.config && data.config.latest_version) {
      checkVersionDiff(data.config.latest_version, data.config.download_url, data.config.system_notice);
    }

    return data;
  } catch (err) {
    _lastCloudSyncStatus = 'error';
    console.warn('[Kbeautyhub Cloud] fetchCloudAdminData error:', err);
    return null;
  }
}

function compareVersions(v1, v2) {
  const p1 = (v1 || '').split('.').map(Number);
  const p2 = (v2 || '').split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

async function checkVersionDiff(remoteVersion, downloadUrl, notice) {
  const manifest = chrome.runtime.getManifest();
  const currentVersion = manifest.version || '1.9.5';

  if (compareVersions(remoteVersion, currentVersion) > 0) {
    const updateInfo = {
      available: true,
      currentVersion,
      latestVersion: remoteVersion,
      downloadUrl: downloadUrl || '',
      notice: notice || 'Đã có bản cập nhật Kbeautyhub mới! Nhấn để tải về.'
    };
    await chrome.storage.local.set({ kbeauty_update_info: updateInfo });
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#25F4EE' });
  } else {
    await chrome.storage.local.remove('kbeauty_update_info');
  }
}

// Lifecycle: onInstalled
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Kbeautyhub] Extension installed/updated. Reason:', details.reason);

  try {
    const existing = await chrome.storage.local.get([
      'kbeauty_device_id',
      'kbeauty_is_unlocked',
      'kbeauty_access_password',
      'kbeauty_guest_password',
      'kbeauty_master_enabled',
      'kbeauty_devices',
      'kbeauty_history',
      'kbeauty_cloud_url',
      'kbeauty_cloud_remote_devices',
      'kbeauty_cloud_remote_history'
    ]);

    const toSet = {};

    // Device ID
    let deviceId = existing.kbeauty_device_id;
    if (!deviceId) {
      deviceId = generateDeviceId();
      toSet.kbeauty_device_id = deviceId;
    }

    // Default password and lock state
    if (existing.kbeauty_access_password === undefined || existing.kbeauty_access_password === 'kbeauty2026') {
      toSet.kbeauty_access_password = 'kbeautyhub';
    }
    if (existing.kbeauty_guest_password === undefined) {
      toSet.kbeauty_guest_password = 'guest2026';
    }
    if (existing.kbeauty_is_unlocked === undefined) {
      toSet.kbeauty_is_unlocked = false; // Locked on install until password is typed
    }
    if (existing.kbeauty_master_enabled === undefined) {
      toSet.kbeauty_master_enabled = true; // Master ON/OFF
    }
    if (existing.kbeauty_history === undefined) {
      toSet.kbeauty_history = [];
    }
    if (existing.kbeauty_cloud_url === undefined) {
      toSet.kbeauty_cloud_url = '';
    }
    if (existing.kbeauty_cloud_remote_devices === undefined) {
      toSet.kbeauty_cloud_remote_devices = [];
    }
    if (existing.kbeauty_cloud_remote_history === undefined) {
      toSet.kbeauty_cloud_remote_history = [];
    }

    // Register / update this device in devices list
    let devices = existing.kbeauty_devices || [];
    const devIndex = devices.findIndex(d => d.deviceId === deviceId);
    const currentDeviceData = {
      deviceId,
      deviceName: detectDeviceEnvironment(),
      screenResolution: '1920x1080',
      registeredAt: Date.now(),
      lastActive: Date.now(),
      status: 'online',
      isAuthorized: true,
      currentWatching: null
    };

    if (devIndex >= 0) {
      devices[devIndex].lastActive = Date.now();
      devices[devIndex].status = 'online';
    } else {
      devices.push(currentDeviceData);
    }
    toSet.kbeauty_devices = devices;

    await chrome.storage.local.set(toSet);

    // Initial cloud heartbeat & update check if URL exists
    if (existing.kbeauty_cloud_url) {
      syncTelemetryToCloud(currentDeviceData);
    }
  } catch (err) {
    console.error('[Kbeautyhub] Error initializing settings:', err);
  }
});

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      // 1. Badge updates
      if (message.action === 'SET_BADGE') {
        const { kbeauty_master_enabled } = await chrome.storage.local.get('kbeauty_master_enabled');
        if (kbeauty_master_enabled === false) {
          if (sender.tab?.id) {
            await chrome.action.setBadgeText({ tabId: sender.tab.id, text: 'OFF' });
            await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#6B7280' });
          }
          sendResponse({ success: true });
          return;
        }

        const text = message.count && message.count > 0 ? String(message.count) : '';
        if (sender.tab?.id) {
          await chrome.action.setBadgeText({ tabId: sender.tab.id, text });
          await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#FE2C55' });
        }
        sendResponse({ success: true });
        return;
      }

      // 2. Active tab lookup
      if (message.action === 'GET_ACTIVE_TAB') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ tab });
        return;
      }

      // 3. TikWM Stream Resolver (bypasses page CSP)
      if (message.action === 'RESOLVE_TIKWM') {
        const { videoId } = message;
        console.log('[Kbeautyhub Background] Resolving videoId via TikWM:', videoId);
        const fullUrl = `https://www.tiktok.com/@user/video/${videoId}`;
        const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(fullUrl)}`);
        if (!response.ok) {
          sendResponse({ success: false, error: `HTTP ${response.status}` });
          return;
        }
        const json = await response.json();
        sendResponse({ success: true, data: json });
        return;
      }

      // 4. Resolve Shop Info from TikTok Shop PDP
      if (message.action === 'RESOLVE_PDP_SHOP_INFO') {
        const { productId } = message;
        if (!productId) {
          sendResponse({ success: false });
          return;
        }

        if (globalThis._pdpCache && globalThis._pdpCache[productId]) {
          sendResponse({ success: true, ...globalThis._pdpCache[productId] });
          return;
        }

        try {
          let res = await fetch(`https://shop.tiktok.com/vn/pdp/${productId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
          if (!res.ok) {
            res = await fetch(`https://shop.tiktok.com/pdp/${productId}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
          }
          if (res.ok) {
            const html = await res.text();
            let rawShopName = null;
            const sNameMatch = html.match(/"(?:shop_name|shopName|seller_name|sellerName)"\s*:\s*"([^"]+)"/i)
              || html.match(/"shop_info"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i);
            if (sNameMatch) {
              try {
                rawShopName = JSON.parse(`"${sNameMatch[1]}"`);
              } catch (e) {
                rawShopName = sNameMatch[1];
              }
            }

            const sellerIdMatch = html.match(/"(?:seller_id|sellerId)"\s*:\s*"([^"]+)"/i);
            const ratingMatch = html.match(/"overall_score"\s*:\s*([0-9.]+)/i);

            const info = {
              shopName: rawShopName,
              sellerId: sellerIdMatch ? sellerIdMatch[1] : null,
              rating: ratingMatch ? ratingMatch[1] : null
            };

            if (!globalThis._pdpCache) globalThis._pdpCache = {};
            globalThis._pdpCache[productId] = info;

            sendResponse({ success: true, ...info });
            return;
          }
        } catch (e) {
          console.warn('[Kbeautyhub] PDP resolve error:', e);
        }

        sendResponse({ success: false });
        return;
      }

      // 5. Active video broadcast
      if (message.action === 'ACTIVE_VIDEO_CHANGED') {
        globalThis._lastActiveVideo = {
          videoId: message.videoId,
          videoData: message.videoData
        };
        sendResponse({ success: true });
        return;
      }

      if (message.action === 'GET_CACHED_ACTIVE_VIDEO') {
        sendResponse({ lastActive: globalThis._lastActiveVideo || null });
        return;
      }

      // 6. Device Heartbeat & Real-Time Tracking
      if (message.action === 'DEVICE_HEARTBEAT') {
        const { currentWatching, screen } = message.data || {};
        const { kbeauty_device_id, kbeauty_devices } = await chrome.storage.local.get([
          'kbeauty_device_id',
          'kbeauty_devices'
        ]);

        let devices = kbeauty_devices || [];
        const devId = kbeauty_device_id || 'KBH-PC-DEFAULT';
        let dev = devices.find(d => d.deviceId === devId);

        if (!dev) {
          dev = {
            deviceId: devId,
            deviceName: detectDeviceEnvironment(),
            screenResolution: screen || '1920x1080',
            registeredAt: Date.now(),
            lastActive: Date.now(),
            status: 'online',
            isAuthorized: true,
            currentWatching: null
          };
          devices.push(dev);
        }

        dev.lastActive = Date.now();
        dev.status = 'online';
        if (screen) dev.screenResolution = screen;
        if (currentWatching) {
          dev.currentWatching = {
            ...currentWatching,
            updatedAt: Date.now()
          };
        }

        // Clean up offline status for devices inactive > 3 minutes
        const now = Date.now();
        devices.forEach(d => {
          if (now - d.lastActive > 3 * 60 * 1000) {
            d.status = 'offline';
          } else {
            d.status = 'online';
          }
        });

        await chrome.storage.local.set({ kbeauty_devices: devices });
        // Sync heartbeat telemetry to cloud if connected
        syncTelemetryToCloud(dev);
        sendResponse({ success: true });
        return;
      }

      // 7. Verify Activation Password (Admin or Guest)
      if (message.action === 'VERIFY_ACTIVATION_PASSWORD') {
        const { password } = message;
        const { kbeauty_access_password, kbeauty_guest_password, kbeauty_device_id, kbeauty_devices } = await chrome.storage.local.get([
          'kbeauty_access_password',
          'kbeauty_guest_password',
          'kbeauty_device_id',
          'kbeauty_devices'
        ]);

        const adminPass = kbeauty_access_password || 'kbeautyhub';
        const guestPass = kbeauty_guest_password || 'guest2026';
        const inputPass = (password || '').trim();

        let role = null;
        if (inputPass === adminPass) {
          role = 'admin';
        } else if (inputPass === guestPass) {
          role = 'guest';
        }

        if (role) {
          await chrome.storage.local.set({
            kbeauty_is_unlocked: true,
            kbeauty_user_role: role
          });

          // Update device status to authorized & save role
          let devices = kbeauty_devices || [];
          const dev = devices.find(d => d.deviceId === kbeauty_device_id);
          if (dev) {
            dev.isAuthorized = true;
            dev.role = role;
            dev.unlockedAt = Date.now();
            await chrome.storage.local.set({ kbeauty_devices: devices });
            // Sync login event to cloud
            syncTelemetryToCloud(dev);
          }

          // Notify all tabs of unlock
          const tabs = await chrome.tabs.query({ url: '*://*.tiktok.com/*' });
          tabs.forEach(t => {
            chrome.tabs.sendMessage(t.id, { action: 'UNLOCK_STATE_CHANGED', unlocked: true, role }).catch(() => {});
          });

          sendResponse({ success: true, role });
        } else {
          sendResponse({ success: false, error: 'Mật khẩu kích hoạt không chính xác!' });
        }
        return;
      }

      // 8. Lock Extension
      if (message.action === 'LOCK_EXTENSION') {
        await chrome.storage.local.set({ kbeauty_is_unlocked: false, kbeauty_user_role: null });
        const tabs = await chrome.tabs.query({ url: '*://*.tiktok.com/*' });
        tabs.forEach(t => {
          chrome.tabs.sendMessage(t.id, { action: 'UNLOCK_STATE_CHANGED', unlocked: false }).catch(() => {});
        });
        sendResponse({ success: true });
        return;
      }

      // 9. Change Admin Access Password
      if (message.action === 'CHANGE_ACCESS_PASSWORD') {
        const { oldPassword, newPassword } = message;
        const { kbeauty_access_password } = await chrome.storage.local.get('kbeauty_access_password');
        const currentPass = kbeauty_access_password || 'kbeautyhub';

        if (oldPassword !== currentPass) {
          sendResponse({ success: false, error: 'Mật khẩu Admin cũ không đúng!' });
          return;
        }
        if (!newPassword || newPassword.length < 4) {
          sendResponse({ success: false, error: 'Mật khẩu Admin mới phải có ít nhất 4 ký tự!' });
          return;
        }

        await chrome.storage.local.set({ kbeauty_access_password: newPassword });
        sendResponse({ success: true });
        return;
      }

      // 9b. Change Guest Access Password (Admin only)
      if (message.action === 'CHANGE_GUEST_PASSWORD') {
        const { adminPassword, newGuestPassword } = message;
        const { kbeauty_access_password } = await chrome.storage.local.get('kbeauty_access_password');
        const currentAdminPass = kbeauty_access_password || 'kbeautyhub';

        if (adminPassword !== currentAdminPass) {
          sendResponse({ success: false, error: 'Mật khẩu xác nhận Admin không đúng!' });
          return;
        }
        if (!newGuestPassword || newGuestPassword.length < 4) {
          sendResponse({ success: false, error: 'Mật khẩu khách mới phải có ít nhất 4 ký tự!' });
          return;
        }

        await chrome.storage.local.set({ kbeauty_guest_password: newGuestPassword });
        // Push update to cloud backend so all remote guest devices receive it
        updateCloudGuestPassword(newGuestPassword);
        sendResponse({ success: true, newGuestPassword });
        return;
      }

      // 10. Master ON/OFF Switch
      if (message.action === 'SET_MASTER_ENABLED') {
        const { enabled } = message;
        await chrome.storage.local.set({ kbeauty_master_enabled: !!enabled });

        // Update badge globally
        try {
          if (!enabled) {
            await chrome.action.setBadgeText({ text: 'OFF' });
            await chrome.action.setBadgeBackgroundColor({ color: '#6B7280' });
          } else {
            await chrome.action.setBadgeText({ text: '' });
          }
        } catch (e) {}

        // Broadcast to all TikTok tabs
        const tabs = await chrome.tabs.query({ url: '*://*.tiktok.com/*' });
        tabs.forEach(t => {
          chrome.tabs.sendMessage(t.id, { action: 'MASTER_TOGGLE_CHANGED', enabled: !!enabled }).catch(() => {});
        });

        sendResponse({ success: true, enabled: !!enabled });
        return;
      }

      // 11. Sync History Entry (from content script)
      if (message.action === 'SYNC_HISTORY_ENTRY') {
        const { entry } = message;
        if (entry) {
          syncHistoryToCloud(entry);
        }
        sendResponse({ success: true });
        return;
      }

      // 12. Get User History (Role-isolated & Multi-tenant)
      if (message.action === 'GET_USER_HISTORY') {
        const { targetDeviceId } = message;
        const store = await chrome.storage.local.get([
          'kbeauty_history',
          'kbeauty_device_id',
          'kbeauty_user_role',
          'kbeauty_cloud_remote_history'
        ]);

        const currentDeviceId = store.kbeauty_device_id || 'UNKNOWN';
        const role = store.kbeauty_user_role || 'guest';
        const localHistory = store.kbeauty_history || [];

        // STRICT GUEST ISOLATION: Guest can only view history recorded on their own device!
        if (role === 'guest') {
          const guestHistory = localHistory.filter(h => (!h.deviceId || h.deviceId === currentDeviceId));
          sendResponse({ success: true, role, currentDeviceId, items: guestHistory });
          return;
        }

        // ADMIN ACCESS: Merges local history + all remote guest histories synced from Cloud
        const cloudHistory = store.kbeauty_cloud_remote_history || [];
        const mergedMap = new Map();

        cloudHistory.forEach(h => {
          if (h && h.videoId) {
            mergedMap.set(`${h.deviceId || 'DEV'}_${h.videoId}`, h);
          }
        });

        localHistory.forEach(h => {
          if (h && h.videoId) {
            mergedMap.set(`${h.deviceId || currentDeviceId}_${h.videoId}`, {
              ...h,
              deviceId: h.deviceId || currentDeviceId,
              userRole: h.userRole || 'admin'
            });
          }
        });

        let allItems = Array.from(mergedMap.values()).sort((a, b) => {
          const tA = typeof a.savedAt === 'number' ? a.savedAt : (new Date(a.savedAtStr || 0).getTime() || 0);
          const tB = typeof b.savedAt === 'number' ? b.savedAt : (new Date(b.savedAtStr || 0).getTime() || 0);
          return tB - tA;
        });

        if (targetDeviceId && targetDeviceId !== 'ALL') {
          allItems = allItems.filter(h => (h.deviceId === targetDeviceId || (targetDeviceId === 'CURRENT' && h.deviceId === currentDeviceId)));
        }

        sendResponse({ success: true, role, currentDeviceId, items: allItems });
        return;
      }

      // 13. Get Admin Analytics & Aggregated Device Data
      if (message.action === 'GET_ADMIN_DATA') {
        // Trigger non-blocking cloud pull
        fetchCloudAdminData().catch(() => {});

        const store = await chrome.storage.local.get([
          'kbeauty_device_id',
          'kbeauty_devices',
          'kbeauty_history',
          'kbeauty_is_unlocked',
          'kbeauty_user_role',
          'kbeauty_guest_password',
          'kbeauty_master_enabled',
          'kbeauty_cloud_url',
          'kbeauty_cloud_remote_devices',
          'kbeauty_cloud_remote_history',
          'kbeauty_update_info'
        ]);

        const localHistory = store.kbeauty_history || [];
        const cloudHistory = store.kbeauty_cloud_remote_history || [];

        // Merge all histories for comprehensive admin analytics
        const historyMap = new Map();
        cloudHistory.forEach(h => {
          if (h && h.videoId) historyMap.set(`${h.deviceId || 'DEV'}_${h.videoId}`, h);
        });
        localHistory.forEach(h => {
          if (h && h.videoId) historyMap.set(`${h.deviceId || store.kbeauty_device_id}_${h.videoId}`, h);
        });

        const mergedHistory = Array.from(historyMap.values());
        const totalWatched = mergedHistory.length;
        const shopVideos = mergedHistory.filter(h => h.hasShopCart || (h.products && h.products.length > 0));
        const shopVideosCount = shopVideos.length;
        const shopRate = totalWatched > 0 ? Math.round((shopVideosCount / totalWatched) * 100) : 0;

        // Tally shop occurrences
        const shopMap = new Map();
        mergedHistory.forEach(item => {
          if (item && typeof item.shopName === 'string' && !item.shopName.includes('TikTok Shop (') && !item.shopName.startsWith('Shop của @')) {
            shopMap.set(item.shopName, (shopMap.get(item.shopName) || 0) + 1);
          }
          if (item && Array.isArray(item.products)) {
            item.products.forEach(p => {
              if (p && typeof p.shopName === 'string' && !p.shopName.includes('TikTok Shop (') && !p.shopName.startsWith('Shop của @')) {
                shopMap.set(p.shopName, (shopMap.get(p.shopName) || 0) + 1);
              }
            });
          }
        });

        const topShops = Array.from(shopMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);

        // Merge local devices and remote cloud devices
        const localDevices = store.kbeauty_devices || [];
        const cloudDevices = store.kbeauty_cloud_remote_devices || [];
        const deviceMap = new Map();

        cloudDevices.forEach(cd => {
          if (cd && cd.deviceId) {
            deviceMap.set(cd.deviceId, {
              ...cd,
              source: 'cloud'
            });
          }
        });

        const now = Date.now();
        localDevices.forEach(ld => {
          ld.status = (now - ld.lastActive < 3 * 60 * 1000) ? 'online' : 'offline';
          deviceMap.set(ld.deviceId, {
            ...ld,
            source: 'local'
          });
        });

        const allDevices = Array.from(deviceMap.values());
        if (allDevices.length === 0) {
          allDevices.push({
            deviceId: store.kbeauty_device_id || 'KBH-PC-DEFAULT',
            deviceName: detectDeviceEnvironment(),
            role: store.kbeauty_user_role || 'guest',
            status: 'online',
            lastActive: Date.now(),
            source: 'local'
          });
        }

        sendResponse({
          success: true,
          currentDeviceId: store.kbeauty_device_id || 'KBH-PC-UNKNOWN',
          isUnlocked: !!store.kbeauty_is_unlocked,
          isMasterEnabled: store.kbeauty_master_enabled !== false,
          userRole: store.kbeauty_user_role || 'guest',
          guestPassword: store.kbeauty_guest_password || 'guest2026',
          devices: allDevices,
          cloudUrl: store.kbeauty_cloud_url || '',
          cloudSyncStatus: _lastCloudSyncStatus,
          lastCloudSyncTime: _lastCloudSyncTime,
          updateInfo: store.kbeauty_update_info || null,
          analytics: {
            totalWatched,
            shopVideosCount,
            shopRate,
            totalShopsDiscovered: shopMap.size,
            topShops
          }
        });
        return;
      }

      // 14. Cloud Sync Configuration & Management
      if (message.action === 'GET_CLOUD_SYNC_CONFIG') {
        const store = await chrome.storage.local.get([
          'kbeauty_cloud_url',
          'kbeauty_cloud_remote_devices',
          'kbeauty_cloud_remote_history',
          'kbeauty_update_info'
        ]);
        sendResponse({
          success: true,
          cloudUrl: store.kbeauty_cloud_url || '',
          lastSyncTime: _lastCloudSyncTime,
          lastSyncStatus: _lastCloudSyncStatus,
          remoteDevicesCount: (store.kbeauty_cloud_remote_devices || []).length,
          remoteHistoryCount: (store.kbeauty_cloud_remote_history || []).length,
          updateInfo: store.kbeauty_update_info || null
        });
        return;
      }

      if (message.action === 'SAVE_CLOUD_URL') {
        const { cloudUrl } = message;
        const trimmed = (cloudUrl || '').trim();
        await chrome.storage.local.set({ kbeauty_cloud_url: trimmed });

        if (trimmed) {
          const testRes = await fetchCloudAdminData();
          sendResponse({
            success: true,
            status: testRes ? 'connected' : 'error',
            message: testRes ? 'Kết nối Cloud thành công!' : 'Không thể kết nối URL này. Vui lòng kiểm tra quyền truy cập Web App.'
          });
        } else {
          _lastCloudSyncStatus = 'offline';
          sendResponse({ success: true, status: 'offline', message: 'Đã tắt Cloud Sync' });
        }
        return;
      }

      if (message.action === 'FORCE_CLOUD_SYNC') {
        const cloudData = await fetchCloudAdminData();
        const { kbeauty_devices, kbeauty_device_id } = await chrome.storage.local.get(['kbeauty_devices', 'kbeauty_device_id']);
        const curDev = (kbeauty_devices || []).find(d => d.deviceId === kbeauty_device_id);
        if (curDev) {
          await syncTelemetryToCloud(curDev);
        }
        sendResponse({
          success: !!cloudData,
          status: _lastCloudSyncStatus,
          lastSyncTime: _lastCloudSyncTime,
          cloudData
        });
        return;
      }

      // 15. Revoke Device
      if (message.action === 'REVOKE_DEVICE') {
        const { deviceId } = message;
        let { kbeauty_devices, kbeauty_device_id } = await chrome.storage.local.get(['kbeauty_devices', 'kbeauty_device_id']);
        let devices = kbeauty_devices || [];
        devices = devices.filter(d => d.deviceId !== deviceId);
        await chrome.storage.local.set({ kbeauty_devices: devices });

        if (deviceId === kbeauty_device_id) {
          await chrome.storage.local.set({ kbeauty_is_unlocked: false });
        }
        sendResponse({ success: true });
        return;
      }

      sendResponse({ status: 'unknown_action' });
    } catch (err) {
      console.error('[Kbeautyhub] Message handling error:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});
