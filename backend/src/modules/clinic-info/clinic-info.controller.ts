import type { Request, Response } from 'express';
import { listClinicInfo } from '../admin/clinic-info.service.js';

/** Thông tin phòng khám công khai (giờ làm việc, bảng giá, quy định…), dùng cho trang FAQ. */
export async function list(_req: Request, res: Response) {
  res.json({ items: await listClinicInfo() });
}
