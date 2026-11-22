# Spec: Dock thu gọn vào bong bóng + chạm web dưới thanh địa chỉ

**Nhánh/commit:** main · **Ngày:** 2026-11-22 · **Trạng thái:** đã làm, chờ Tyson test trên máy

## Yêu cầu (Tyson)

1. Vùng từ thanh địa chỉ đổ xuống: chỗ nào không phải dock / thanh địa chỉ thì chạm vào web bình thường.
2. Thêm nút **+** (thẻ mới) vào dock, ngay bên phải nút **>**.
3. Bong bóng tròn (trước là nút +) đổi thành nút **><**. Bấm → dock + thanh địa chỉ thu gọn vào bong bóng (có animation),
   bong bóng nằm góc dưới bên phải (màn dọc) / góc trên bên phải (màn ngang).
4. Bong bóng thu gọn vẫn tương tác được: bấm để bung lại, vuốt để mở màn các thẻ.

## Quyết định (Claude tự chọn vì chưa hỏi lại được — đổi được)

| Câu hỏi | Đã chọn |
|---|---|
| Icon khi đã thu gọn | `expand` (mũi tên bung ra), màu accent; đổi chéo + xoay 90° với `contract` |
| Giữ trạng thái thu gọn | Giữ khi đổi thẻ / đổi trang; vào màn các thẻ thì dock hiện lại, quay về trang lại thu gọn. Không lưu qua lần mở app |
| Cuộn trang → thanh địa chỉ thu thành kính lúp | Giữ nguyên khi dock đầy đủ; tắt khi đang thu gọn |
| Nút + trong dock | Cố định (không nằm trong danh sách tuỳ chỉnh); màn ngang nằm trong dock dọc dưới nút > |
| Kiểu dock "dính đáy" (attached) | Không có bong bóng, giữ nút + ở cuối hàng như cũ |
| Vuốt bong bóng | Màn dọc: vuốt lên → màn các thẻ, vuốt ngang → đổi thẻ. Màn ngang: kéo sang trái / xuống → màn các thẻ |

## Nguyên nhân lỗi 1 (giả thuyết, cần test trên máy)

Các lớp React Native đều `pointerEvents="box-none"`, không chặn chạm. Nhưng `RyxEdge.obscure()` báo cho WebKit
(`obscuredContentInsets` + `setMinimumViewportInset`) cả dải ngang từ thanh địa chỉ xuống đáy là bị che.
Sửa: chỉ báo vùng che phía trên (`setWebInsets(insetTop, 0)`), khoảng cuộn dưới giữ nhờ prop `contentInset`.
Làm bằng JS → đi được qua OTA, không cần build lại.

**Đánh đổi:** phần tử `position: fixed; bottom: 0` của trang (thanh cookie, nút chat…) giờ nằm sát đáy, có thể bị dock che.
Thu gọn dock là thấy.

## File đã sửa

- `src/components/dock.tsx` — nút + trong dock, bong bóng ><, animation thu gọn, cử chỉ bong bóng góc (màn ngang)
- `src/app/index.tsx` — trạng thái `dockMinOn` / `mini`, thanh địa chỉ co lại theo, web dùng hết chiều cao khi thu gọn
- `src/components/browser-tab.tsx` — chỉ báo vùng che phía trên cho native

## Kiểm tra trên máy

- [ ] Chạm link/nút của trang ở hai bên dock, dưới thanh địa chỉ
- [ ] Nút + trong dock mở thẻ mới (thẻ bay ra từ nút)
- [ ] Bấm >< : dock + thanh địa chỉ co mượt vào góc; bấm lại bung ra
- [ ] Thu gọn: vuốt bong bóng lên → màn các thẻ; vuốt ngang → đổi thẻ
- [ ] Màn ngang: bong bóng góc trên phải, kéo trái/xuống → màn các thẻ
- [ ] Cuối trang vẫn cuộn được lên trên thanh địa chỉ, không bị giật
