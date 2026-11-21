# Ryx — việc để chỉnh sau

Ghi lại theo yêu cầu của Tyson, chưa làm. Làm xong mục nào thì xoá hoặc đánh dấu `[x]`.

## Màn các thẻ (all tab)

- [ ] **Chia đôi (màn dọc): cột thẻ nhỏ bên phải trông hơi nghiêng** → cho thẳng lại.
      Nhiều khả năng do hiệu ứng 3D (rotateY/perspective) của cột nhỏ trong `SplitPortrait`
      (`src/components/tab-overview.tsx`) — cần kiểm tra lại, bỏ nghiêng.
- [ ] **Màn ngang: dock che hàng thẻ nhỏ** (ảnh: dock + nút + đè lên hàng khung ở Chia đôi ngang).
      Chừa chỗ cho dock (hoặc đưa dock sang phải, xem mục dưới) để không che thẻ.

## Màn ngang khi đang xem trang

- [ ] **Dock dọc nằm bên phải màn hình** (icon xoay ngang theo), thanh địa chỉ vẫn ở dưới, nút + ở góc trên bên phải.
- [ ] **Không thu gọn** thanh địa chỉ / dock khi cuộn trang ở màn ngang.
- [ ] **Vuốt mở màn các thẻ:** vuốt từ thanh địa chỉ lên, hoặc từ dock (bên phải) kéo vào giữa màn hình
      → mở màn tất cả thẻ.

## Đã chốt

- Dock bên phải là **dock dọc** (nút xếp từ trên xuống), **icon xoay ngang theo** màn hình
  (cầm ngang thì icon vẫn đứng thẳng, đúng chiều đọc).
- **Nút + (thẻ mới) nằm góc trên bên phải.**
