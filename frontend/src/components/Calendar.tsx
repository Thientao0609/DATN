import type { ComponentProps } from 'react';
import { DayPicker } from 'react-day-picker';
import { vi } from 'react-day-picker/locale';
import { Icon } from './Icon';

export type CalendarProps = ComponentProps<typeof DayPicker>;

/**
 * Lịch tháng tiếng Việt, dựa trên react-day-picker (cùng thư viện mà Calendar của shadcn/ui dùng).
 * Kiểu dáng nằm trong styles/scheduler.css và chỉ dùng biến của tokens.css.
 */
export function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      locale={vi}
      showOutsideDays
      className={['calendar', className].filter(Boolean).join(' ')}
      components={{
        Chevron: ({ orientation }) => <Icon name={orientation === 'left' ? 'left' : 'right'} size={16} />,
      }}
      {...props}
    />
  );
}
