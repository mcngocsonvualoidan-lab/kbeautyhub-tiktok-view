/**
 * ============================================================
 * KBEAUTYHUB TIKTOK VIEW - GOOGLE APPS SCRIPT CLOUD BACKEND
 * Phiên bản: v1.9.8 | Tác giả: Son Designer
 * ============================================================
 * 
 * ĐÂY LÀ HỆ THỐNG MÁY CHỦ CLOUD HOÀN TOÀN MIỄN PHÍ 100% CỦA GOOGLE.
 * Chạy 24/7 trên Google Cloud, không tốn tiền hosting hay VPS.
 * 
 * HƯỚNG DẪN CÀI ĐẶT TRONG 2 PHÚT:
 * 1. Mở https://sheets.new để tạo một trang tính Google Sheet mới.
 * 2. Đổi tên Google Sheet thành "Kbeautyhub - TikTok View Data".
 * 3. Trên menu Google Sheet, chọn: Tiện ích mở rộng (Extensions) -> Apps Script.
 * 4. Xóa hết mã cũ trong cửa sổ Apps Script và DÁN TOÀN BỘ NỘI DUNG TỆP NÀY VÀO.
 * 5. Bấm nút 💾 "Lưu dự án" (Ctrl + S).
 * 6. Bấm nút "Triển khai" (Deploy) ở góc trên bên phải -> Chọn "Tùy chọn triển khai mới" (New deployment).
 *    - Chọn loại: "Ứng dụng web" (Web app).
 *    - Mô tả: "Kbeautyhub API v1.9.5".
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me).
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone).
 * 7. Bấm "Triển khai" -> Cấp quyền truy cập cho tài khoản Google của bạn khi được hỏi.
 * 8. SAO CHÉP "URL ứng dụng web" (có đuôi /exec) và dán vào tab Admin của Tiện ích!
 * ============================================================
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'check_updates';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsSetup(ss);

  if (action === 'get_admin_data') {
    var devices = getDevicesList(ss);
    var history = getHistoryList(ss);
    var config = getConfigMap(ss);
    return responseJSON({
      success: true,
      devices: devices,
      history: history,
      config: config
    });
  }

  if (action === 'check_updates') {
    var config = getConfigMap(ss);
    return responseJSON({
      success: true,
      latest_version: config.latest_version || '1.9.5',
      download_url: config.download_url || '',
      guest_password: config.guest_password || 'guest2026',
      system_notice: config.system_notice || 'Hệ thống Kbeautyhub hoạt động ổn định.'
    });
  }

  return responseJSON({ status: 'ready', server: 'Kbeautyhub Cloud v1.9.5' });
}

function doPost(e) {
  try {
    var payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
    var action = payload.action || 'sync_telemetry';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsSetup(ss);

    if (action === 'sync_telemetry' || action === 'sync_device') {
      upsertDevice(ss, payload);
      var config = getConfigMap(ss);
      return responseJSON({
        success: true,
        message: 'Device telemetry updated',
        guest_password: config.guest_password || 'guest2026',
        latest_version: config.latest_version || '1.9.5'
      });
    }

    if (action === 'sync_history') {
      appendHistory(ss, payload);
      return responseJSON({ success: true, message: 'History saved' });
    }

    if (action === 'update_guest_password') {
      updateConfigKey(ss, 'guest_password', payload.newGuestPassword);
      return responseJSON({ success: true, newGuestPassword: payload.newGuestPassword });
    }

    return responseJSON({ success: true, message: 'Received' });
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

// Khởi tạo các Sheet nếu chưa có
function ensureSheetsSetup(ss) {
  // 1. Sheet Thiết bị (Devices)
  var devSheet = ss.getSheetByName('Devices');
  if (!devSheet) {
    devSheet = ss.insertSheet('Devices');
    devSheet.appendRow(['Mã Thiết Bị', 'Tên Máy / Hệ Điều Hành', 'Phân Quyền', 'Trạng Thái', 'Hoạt Động Cuối', 'Video Đang Xem', 'Ngày Đăng Ký']);
    devSheet.getRange(1, 1, 1, 7).setBackground('#1F2937').setFontColor('#FFFFFF').setFontWeight('bold');
    devSheet.setFrozenRows(1);
  }

  // 2. Sheet Lịch Sử (History)
  var histSheet = ss.getSheetByName('History');
  if (!histSheet) {
    histSheet = ss.insertSheet('History');
    histSheet.appendRow(['Thời Gian', 'Mã Thiết Bị', 'Phân Quyền', 'ID Video', 'Kênh Creator', 'Tên Gian Hàng', 'Số SP', 'Tên Sản Phẩm', 'Giá Bán', 'Link Sản Phẩm', 'Link Video']);
    histSheet.getRange(1, 1, 1, 11).setBackground('#111827').setFontColor('#25F4EE').setFontWeight('bold');
    histSheet.setFrozenRows(1);
  }

  // 3. Sheet Cấu Hình (Config)
  var cfgSheet = ss.getSheetByName('Config');
  if (!cfgSheet) {
    cfgSheet = ss.insertSheet('Config');
    cfgSheet.appendRow(['Cài Đặt', 'Giá Trị', 'Ghi Chú']);
    cfgSheet.appendRow(['latest_version', '2.0.4', 'Phiên bản mới nhất của tiện ích']);
    cfgSheet.appendRow(['guest_password', 'guest2026', 'Mật khẩu chung cấp cho khách']);
    cfgSheet.appendRow(['download_url', 'https://github.com/mcngocsonvualoidan-lab/kbeautyhub-tiktok-view/releases/download/v2.0.4/Kbeautyhub-Tiktok-View-v2.0.4.zip', 'Link tải file zip phiên bản mới']);
    cfgSheet.appendRow(['system_notice', 'Chào mừng bạn đến với Kbeautyhub TikTok View!', 'Thông báo đẩy cho người dùng']);
    cfgSheet.getRange(1, 1, 1, 3).setBackground('#374151').setFontColor('#FFB800').setFontWeight('bold');
    cfgSheet.setFrozenRows(1);
  }
}

// Ghi nhận / Cập nhật thiết bị
function upsertDevice(ss, data) {
  var sheet = ss.getSheetByName('Devices');
  if (!sheet) return;
  var deviceId = data.deviceId || 'UNKNOWN';
  var dataRows = sheet.getDataRange().getValues();
  var foundRow = -1;

  for (var i = 1; i < dataRows.length; i++) {
    if (dataRows[i][0] == deviceId) {
      foundRow = i + 1;
      break;
    }
  }

  var nowStr = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
  var watchingText = '';
  if (data.currentWatching && data.currentWatching.author) {
    watchingText = '@' + data.currentWatching.author + (data.currentWatching.shopName ? ' • ' + data.currentWatching.shopName : '');
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2).setValue(data.deviceName || dataRows[foundRow - 1][1]);
    sheet.getRange(foundRow, 3).setValue(data.role || dataRows[foundRow - 1][2]);
    sheet.getRange(foundRow, 4).setValue('Online');
    sheet.getRange(foundRow, 5).setValue(nowStr);
    if (watchingText) sheet.getRange(foundRow, 6).setValue(watchingText);
  } else {
    sheet.appendRow([
      deviceId,
      data.deviceName || 'Windows PC',
      data.role || 'guest',
      'Online',
      nowStr,
      watchingText,
      nowStr
    ]);
  }
}

// Ghi nhận Lịch sử xem sản phẩm từ xa
function appendHistory(ss, data) {
  var sheet = ss.getSheetByName('History');
  if (!sheet) return;
  var entry = data.entry || data;
  var nowStr = Utilities.formatDate(new Date(entry.savedAt || Date.now()), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');

  var prods = entry.products || [];
  var firstProd = prods.length > 0 ? prods[0] : {};
  var pTitle = firstProd.title || '';
  var pPrice = firstProd.price || '';
  var pLink = firstProd.webUrl || (firstProd.productId ? 'https://shop.tiktok.com/vn/pdp/' + firstProd.productId : '');
  var vUrl = entry.videoId ? 'https://www.tiktok.com/@' + (entry.author?.uniqueId || 'user') + '/video/' + entry.videoId : '';

  sheet.appendRow([
    nowStr,
    entry.deviceId || 'UNKNOWN',
    entry.userRole || 'guest',
    entry.videoId || '',
    entry.author?.uniqueId ? '@' + entry.author.uniqueId : '',
    entry.shopName || firstProd.shopName || '',
    prods.length,
    pTitle,
    pPrice,
    pLink,
    vUrl
  ]);
}

// Lấy danh sách thiết bị
function getDevicesList(ss) {
  var sheet = ss.getSheetByName('Devices');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    list.push({
      deviceId: r[0],
      deviceName: r[1],
      role: r[2],
      status: r[3],
      lastActiveStr: r[4],
      watching: r[5],
      registeredAtStr: r[6]
    });
  }
  return list;
}

// Lấy lịch sử tất cả khách
function getHistoryList(ss) {
  var sheet = ss.getSheetByName('History');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  var list = [];
  // Lấy tối đa 300 bản ghi mới nhất từ dưới lên
  var start = Math.max(1, rows.length - 300);
  for (var i = rows.length - 1; i >= start; i--) {
    var r = rows[i];
    if (!r[3]) continue; // videoId
    list.push({
      savedAtStr: r[0],
      deviceId: r[1],
      userRole: r[2],
      videoId: r[3],
      author: { uniqueId: String(r[4]).replace('@', '') },
      shopName: r[5],
      productCount: r[6],
      products: [{
        title: r[7],
        price: r[8],
        webUrl: r[9]
      }],
      videoUrl: r[10]
    });
  }
  return list;
}

// Đọc cấu hình
function getConfigMap(ss) {
  var sheet = ss.getSheetByName('Config');
  if (!sheet) return {};
  var rows = sheet.getDataRange().getValues();
  var config = {};
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      config[String(rows[i][0]).trim()] = String(rows[i][1] || '').trim();
    }
  }
  return config;
}

// Cập nhật giá trị cấu hình
function updateConfigKey(ss, key, value) {
  var sheet = ss.getSheetByName('Config');
  if (!sheet) return;
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] == key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, 'Auto updated']);
}

// Helper trả về JSON cho Chrome Extension
function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
