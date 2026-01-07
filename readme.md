
# Library Counter Simulation (Tạ Quang Bửu)

Mô phỏng hệ thống quầy mượn/trả sách của Thư viện Tạ Quang Bửu (HUST) bằng HTML/CSS/JS + Node.js (Express).

## Yêu cầu

- Node.js 18+ (khuyến nghị 18/20)
- npm (đi kèm Node.js)

## Cài đặt

Mở terminal tại thư mục dự án và chạy:

```bash
npm install
```

## Chạy dự án

### Cách 1 (chuẩn):

```bash
npm start
```

Mặc định server chạy cổng `3000`.

Mở trình duyệt:

- http://localhost:3000

### Nếu bị lỗi trùng cổng 3000 (EADDRINUSE)

Bạn có thể đổi cổng bằng biến môi trường `PORT`.

**PowerShell (Windows):**

```powershell
$env:PORT=3001
npm start
```

Sau đó mở:

- http://localhost:3001

## Cách kiểm tra nhanh (tự test)

### 1 Chạy mô phỏng cơ bản

1. Nhập tham số (ví dụ):
	- Số quầy `n = 2`
	- Thời gian giữa 2 lượt đến (TB) `= 4s`
	- Thời gian phục vụ TB `= 20s`
	- Chính sách: `1 hàng chung FIFO`
2. Bấm **Bắt đầu mô phỏng**.
3. Quan sát:
	- Hàng chờ hiển thị ở khu vực mô phỏng.
	- Các chỉ số tổng hợp cập nhật liên tục (W, L, ρ, λ, throughput...).
4. Bấm **Dừng** để xem bảng kết quả (report) theo từng quầy.

### 2 Kiểm tra Balking / Reneging (để ra số khác 0)

- **Balking** chỉ xuất hiện khi đặt `Giới hạn hàng chờ tối đa (maxQueue) > 0`.
- **Reneging** chỉ xuất hiện khi đặt `Ngưỡng bỏ hàng (patience) > 0`.

Gợi ý cấu hình để dễ thấy 2 chỉ số này:

- `n = 1` hoặc `2`
- `inter-arrival TB = 1–2s` (đến dày)
- `service TB = 20–30s` (phục vụ chậm)
- `maxQueue = 5–15`
- `patience = 30–120s`

Chạy mô phỏng đủ lâu hoặc dùng **Chạy nhiều lần** để dễ phát sinh trường hợp.

## Hướng dẫn các nút chính

### Điều khiển mô phỏng

- **Bắt đầu mô phỏng**: chạy mô phỏng theo tham số hiện tại.
- **Dừng**: dừng mô phỏng và hiện report kết quả.
- **Reset**: reset mô phỏng (xóa hàng chờ, số liệu, thời gian).

### Thống kê & Replication

- **Preset: Cân bằng**: điền nhanh cấu hình “tải vừa” để chạy ổn định.
- **Preset: Giờ cao điểm**: điền nhanh cấu hình “tải cao” để dễ thấy ùn tắc/hàng chờ tăng.
- **Thống kê** (theo “Khoảng (s)”): tính thống kê trong X giây gần nhất.
- **Ghi mốc cấu hình**: lưu “mốc” (thời điểm + cấu hình) để xem thống kê theo giai đoạn.
  - **Reset thời gian khi ghi mốc**: bật thì mốc mới tính như “epoch” mới để so sánh dễ hơn.
- **Thống kê theo mốc**: tính thống kê từ mốc gần nhất đến thời điểm hiện tại.
- **Hiển thị biểu đồ**: bật/tắt phần Dashboard (biểu đồ theo thời gian).

### Chạy nhiều lần (replications)

- **Số lần mô phỏng**: số replications (khuyến nghị 30–200).
- **Chạy nhiều lần**: chạy mô phỏng lặp theo số lần và duration.
- **Phân tích lỗi thống kê**: mở bảng phân tích (mean/sd/CI + mức đánh giá + bảng từng replication).
- **Xuất CSV**: tải file `replications.csv` (có cả cột `seed` để tái lập).

## Phím tắt

- `Space`: Tạm dừng / tiếp tục
- `L`: Đổi policy
- `T`: Bật/tắt ưu tiên
- `R`: Reset

## Ghi chú về chỉ số

- `λ` (lambda): tốc độ SV đến quan sát được (SV/giây).
- `Throughput`: tốc độ SV rời hệ do được phục vụ xong (SV/giây).
- `ρ`: mức sử dụng quầy (%).
- `W`: thời gian chờ trung bình (giây).
- `L`: độ dài hàng chờ trung bình.
- `P90`: phân vị 90% của thời gian chờ.

