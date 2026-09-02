'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Item = { href: string; label: string; icon: 'home' | 'search' | 'building' | 'pen' | 'inbox' | 'gear' }

const ITEMS: Item[] = [
  { href: '/', label: 'Panel', icon: 'home' },
  { href: '/discover', label: 'Keşfet', icon: 'search' },
  { href: '/companies', label: 'Şirketler', icon: 'building' },
  { href: '/compose', label: 'Mail Yaz', icon: 'pen' },
  { href: '/inbox', label: 'Gelen Kutusu', icon: 'inbox' },
  { href: '/settings', label: 'Ayarlar', icon: 'gear' },
]

const PATHS: Record<Item['icon'], string> = {
  home: 'M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1h11.5a1 1 0 0 0 1-1V9.75',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  building: 'M4 21h16M6 21V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v17M14 9h3a1 1 0 0 1 1 1v11M9 7h2M9 11h2M9 15h2',
  pen: 'M4 20h4L20 8a2.5 2.5 0 0 0-3.5-3.5L4 16.5V20Z',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M3 13V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v7m-18 0v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.14-1.5l2-1.55-2-3.46-2.35.95a8.4 8.4 0 0 0-2.6-1.5L15 2h-4l-.31 2.44a8.4 8.4 0 0 0-2.6 1.5L5.74 5 3.74 8.45l2 1.55A8.4 8.4 0 0 0 5.6 12c0 .51.05 1.01.14 1.5l-2 1.55 2 3.46 2.35-.95c.78.65 1.66 1.16 2.6 1.5L11 22h4l.31-2.44a8.4 8.4 0 0 0 2.6-1.5l2.35.95 2-3.46-2-1.55c.09-.49.14-.99.14-1.5Z',
}

function Icon({ name }: { name: Item['icon'] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[18px] shrink-0"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-brand)] text-sm font-semibold text-white">
          M
        </span>
        <span className="text-[15px] font-semibold tracking-tight">MailBot</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ' +
                (active
                  ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand)]'
                  : 'text-[var(--color-muted)] hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]')
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto px-5 py-4 text-[11px] text-[var(--color-muted)]">
        Yerel kurulum · localhost
      </div>
    </aside>
  )
}
