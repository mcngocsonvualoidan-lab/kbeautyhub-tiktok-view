# 🛍️ Kbeautyhub - TikTok View Giỏ Hàng & Shop PC (v1.9.9)

> **Developed by Son Designer • Kbeautyhub**  
> Tiện ích mở rộng Chrome Extension Manifest V3 xem trực tiếp thông tin sản phẩm, giá bán, link mua sắm TikTok Shop và tên Shop bán sản phẩm từ video có gắn giỏ hàng ngay trên máy tính (PC/Laptop).

---

## 🚀 LINK CÀI ĐẶT ONLINE TRỰC TIẾP (GITHUB)

- 📥 **Tải bản cài đặt nhanh (.ZIP):**  
  [**Tải Kbeautyhub-Tiktok-View-v1.9.9.zip**](https://github.com/mcngocsonvualoidan-lab/kbeautyhub-tiktok-view/releases/download/v1.9.9/Kbeautyhub-Tiktok-View-v1.9.9.zip)
- 🌐 **Repository GitHub:**  
  [https://github.com/mcngocsonvualoidan-lab/kbeautyhub-tiktok-view](https://github.com/mcngocsonvualoidan-lab/kbeautyhub-tiktok-view)

---

## 🔑 MẬT KHẨU SỬ DỤNG

| Loại tài khoản | Mật khẩu | Quyền hạn |
| :--- | :--- | :--- |
| **Khách (Guest)** | `guest2026` | Xem video, xem giỏ hàng, mở link shop, xem lịch sử cá nhân riêng tư |
| **Quản trị (Admin)** | `kbeautyhub` | Toàn quyền cấu hình, quản lý tất cả thiết bị online, xem lịch sử tổng hợp của tất cả các máy, đồng bộ Google Cloud |

---

## 🌟 TÍNH NĂNG NỔI BẬT TRÊN BẢN v1.9.9

1. **Hiển thị video đè lên vị trí nút Play (Khung video bên trái):**
   - Khi vào trang cá nhân của từng Shop / Creator và mở video có gắn giỏ hàng, video HTML5 được giải mã và gắn chuẩn xác lên khung phát bên trái đè lên nút Play, tự động phát mượt mà.
   - **Bảo toàn 100% thanh bình luận, lượt tương tác (Like, Share, Reaction) bên phải**, hoàn toàn không bị che khuất hay can thiệp.
2. **Nhận diện Giỏ hàng tức thì khi cuộn trang:**
   - Quét DOM anchor theo thời gian thực (nhận diện các thẻ shop như `Rosaleen`, `TikTok Shop`), không cần phải ấn F5 tải lại trang.
3. **Nhận diện Tên Shop bán sản phẩm tức thì (100% không kẹt loading):**
   - Tự động bóc tách tên shop người bán (`shop_name`, `seller_name`, `brand_name`) từ dữ liệu TikTok.
   - Fallback thông minh sang Gian hàng Creator (`Author Nickname (@uniqueId)`) kèm nút `↗️ Vào Shop` mở trực tiếp gian hàng trên TikTok.
2. **Xem và phát video mượt mà trên PC:**
   - Không bị chặn bởi banner giỏ hàng của TikTok, giải mã trực tiếp luồng stream video.
3. **Bật / Tắt tiện ích (Master Switch) linh hoạt:**
   - Nút bật/tắt tiện ích lưu trạng thái vĩnh viễn vào bộ nhớ trình duyệt, không bị tự động bật lại sau khi ấn F5.
4. **Hệ thống phân quyền & Bảo mật:**
   - Màn hình khóa nhập mật khẩu khi cài đặt mới.
   - Lịch sử xem của mỗi tài khoản Guest hoàn toàn độc lập và riêng tư.
5. **Đồng bộ hóa Online Miễn Phí (Google Apps Script / Sheets):**
   - Không tốn chi phí server. Tự động ghi nhận thiết bị đăng nhập thời gian thực và lịch sử xem lên Google Sheet dành riêng cho Admin.
6. **Xuất báo cáo Excel / CSV chuẩn định dạng:**
   - Xuất dữ liệu video, sản phẩm, giá, tên shop ra file Excel/CSV chuẩn cột hàng, hỗ trợ tiếng Việt có dấu (UTF-8 with BOM).

---

## 💻 HƯỚNG DẪN CÀI ĐẶT NHANH TRÊN CHROME / CỐC CỐC / EDGE

### Cách 1: Cài đặt từ file Zip tải về (Được khuyên dùng)
1. Tải file [**Kbeautyhub-Tiktok-View-v1.9.6.zip**](https://github.com/mcngocsonvualoidan-lab/kbeautyhub-tiktok-view/raw/main/Kbeautyhub-Tiktok-View-v1.9.6.zip) về máy tính.
2. Giải nén file zip ra một thư mục (ví dụ: `kbeautyhub-tiktok-view`).
3. Mở trình duyệt và truy cập `chrome://extensions` (hoặc `coccoc://extensions` / `edge://extensions`).
4. Gạt công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải sang **BẬT (ON)**.
5. Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục vừa giải nén.
6. Nhấn vào biểu tượng tiện ích Kbeautyhub trên thanh công cụ, nhập mật khẩu `guest2026` (hoặc `kbeautyhub` cho Admin) để bắt đầu sử dụng!

### Cách 2: Cài đặt qua Git Clone
```bash
git clone https://github.com/mcngocsonvualoidan-lab/kbeautyhub-tiktok-view.git
```
Sau đó vào `chrome://extensions` chọn **Load unpacked** trỏ vào thư mục vừa clone.

---

## 👨‍💻 THÔNG TIN TÁC GIẢ & BẢN QUYỀN
- **Tác giả:** Son Designer • Kbeautyhub
- **Phiên bản:** 1.9.6 (Latest Stable)
- **Hỗ trợ:** Kbeautyhub Team
