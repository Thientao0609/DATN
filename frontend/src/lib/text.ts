/** Bỏ dấu tiếng Việt và chuyển chữ thường, để tìm "huy lich" vẫn ra "Hủy lịch". */
export function normalizeVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
