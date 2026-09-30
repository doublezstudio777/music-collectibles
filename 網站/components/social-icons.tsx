import { SOCIALS, type Links, type SocialKey } from "@/lib/profile-rules";

// 個人頁社群連結（2026-09-30）：單色線條圖示，黑白灰，不用各平台品牌色。
// 連結是使用者填的：新分頁開、noopener nofollow ugc。網址伺服器存之前已過網域白名單，畫之前 parseLinks 又過一次

const PATHS: Record<SocialKey, React.ReactNode> = {
  ig: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  threads: <path d="M16.8 8.6C15.9 5.9 14 4.5 11.9 4.5 7.8 4.5 5 7.4 5 12s2.8 7.5 6.9 7.5c3.6 0 6.1-2 6.1-4.9 0-2.5-2-4-4.9-4-2.1 0-3.6 1-3.6 2.6 0 1.4 1.2 2.4 2.8 2.4 2.7 0 3.8-2.1 3.6-5.9" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" />
    </>
  ),
  facebook: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M13.6 8.4h-1c-.9 0-1.6.7-1.6 1.6v10.4M9 13.2h5.6" />
    </>
  ),
};

export function SocialIcons({ links }: { links: Links }) {
  const list = SOCIALS.filter((s) => links[s.key]);
  if (!list.length) return null;
  return (
    <ul className="social-links" data-testid="profile-links">
      {list.map((s) => (
        <li key={s.key}>
          <a className="social-link" href={links[s.key]} target="_blank" rel="noopener nofollow ugc" aria-label={s.label} title={s.label} data-key={s.key}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {PATHS[s.key]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
