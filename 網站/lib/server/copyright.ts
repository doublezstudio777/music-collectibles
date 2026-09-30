// 權利侵害通知、取下、回復（2026-10-01 法務修正 M5；著作權法第 90 條之 4 起、使用條款第 11 條）。
//
// 流程（status）：
//   pending   通知人在 /takedown 送出（不用登入），等管理員看
//   removed   管理員移除內容（網址是 /share/N 的收藏自動隱藏；其他網址管理員自己在「審核與下架」處理後按「已手動移除」），
//             同時寄信通知發布的會員，信裡附回復通知的網址
//   rejected  通知不成立（要寫原因）
//   counter   會員登入後在 /takedown/counter?id=N 送出回復通知
//   forwarded 管理員把回復通知轉寄給通知人，restore_due＝10 個工作日後（只扣週六日，國定假日管理員自己看）
//   restored  期滿通知人沒提出起訴證明，回復內容（收藏取消隱藏）
//   upheld    通知人提出起訴證明，維持移除
// 侵權次數（strike）：管理員確認侵權時按「計入侵權次數」，會員的 copyright_strikes 加 1，達 STRIKE_LIMIT 自動停權。
// 每一步都寫進 events（JSON 陣列）＋admin_log，後台看得到完整處理過程。
// 通知人的聯絡方式（Email、電話、地址）只給管理員看，轉給會員的信只帶姓名與通知內容。

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, shares, takedownNotices, users } from "@/db/schema";
import { normEmail, validEmail, type User } from "@/lib/server/auth";
import { getMailer, hit } from "@/lib/server/services";
import { HttpError } from "@/lib/server/trade";
import { setMemberStatus } from "@/lib/server/members";
import { SITE_NAME } from "@/lib/data";
import { CONTACT_EMAIL, RESTORE_WORKDAYS, STRIKE_LIMIT } from "@/lib/legal";

export const RIGHT_TYPES = { copyright: "著作權", trademark: "商標權", portrait: "肖像權", other: "其他權利" } as const;
export type RightType = keyof typeof RIGHT_TYPES;
export const ROLES = { owner: "權利人本人", agent: "權利人的代理人" } as const;
export const TAKEDOWN_STATUS: Record<string, string> = {
  pending: "待處理",
  removed: "已移除，已通知會員",
  rejected: "不成立",
  counter: "會員提出回復通知",
  forwarded: "已轉送回復通知，等通知人",
  restored: "已回復內容",
  upheld: "通知人已起訴，維持移除",
};
export const MAX_URLS = 10;
const nowIso = () => new Date().toISOString();
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

type Event = { at: string; by: string; action: string; note?: string };
const parse = <T,>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

/** 加 n 個工作日（只跳過週六日，台灣時間） */
export function addWorkdays(from: Date, n: number) {
  const d = new Date(from.getTime() + 8 * 3600_000);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return new Date(d.getTime() - 8 * 3600_000).toISOString();
}

/** 網址 → 收藏流水號（只認本站 /share/N） */
function shareNos(urls: string[]) {
  const out = new Set<number>();
  for (const u of urls) {
    const m = u.match(/(?:^|\/\/(?:www\.)?lemibox\.com|^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)\/share\/(\d+)(?:[/?#]|$)/) ?? u.match(/^\/share\/(\d+)(?:[/?#]|$)/);
    if (m) out.add(Number(m[1]));
  }
  return [...out];
}

/* ---------- 通知人送出 ---------- */

export async function submitNotice(ip: string | null, b: Record<string, unknown>) {
  const name = clip(b.name, 100);
  const email = normEmail(b.email);
  const phone = clip(b.phone, 40);
  const address = clip(b.address, 200);
  const role = b.role;
  const rightType = b.rightType;
  const work = clip(b.work, 1000);
  const detail = clip(b.detail, 2000);
  const urls = (typeof b.urls === "string" ? b.urls.split(/\s+/) : Array.isArray(b.urls) ? b.urls : [])
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
  if (!name) throw new HttpError(400, "INVALID", "填你的姓名或公司名稱");
  if (!validEmail(email)) throw new HttpError(400, "INVALID_EMAIL", "Email 格式不對");
  if (!(typeof role === "string" && role in ROLES)) throw new HttpError(400, "INVALID", "選你是權利人本人還是代理人");
  if (!(typeof rightType === "string" && rightType in RIGHT_TYPES)) throw new HttpError(400, "INVALID", "選被侵害的權利");
  if (!work) throw new HttpError(400, "INVALID", "說明你的作品或權利");
  if (!urls.length) throw new HttpError(400, "INVALID", "貼上站上內容的網址");
  if (urls.length > MAX_URLS) throw new HttpError(400, "INVALID", `一次最多 ${MAX_URLS} 個網址，其他請分開送`);
  if (urls.some((u) => !/^(https?:\/\/[^\s]+|\/[^\s]*)$/.test(u) || u.length > 300)) throw new HttpError(400, "INVALID", "網址格式不對，一行一個");
  if (!detail) throw new HttpError(400, "INVALID", "說明侵害的情形");
  if (b.sworn !== true) throw new HttpError(400, "INVALID", "勾選聲明所述屬實");
  if (!(await hit(`takedown:${ip ?? "local"}`, 5, 3600))) throw new HttpError(429, "RATE_LIMITED", "送出太多次了，一小時後再試");

  const nos = shareNos(urls);
  let memberId: string | null = null;
  if (nos.length) {
    const rows = await getDb().select({ a: shares.authorId }).from(shares).where(inArray(shares.no, nos));
    memberId = rows[0]?.a ?? null;
  }
  const at = nowIso();
  const [row] = await getDb()
    .insert(takedownNotices)
    .values({
      claimantName: name,
      claimantEmail: email,
      claimantPhone: phone,
      claimantAddress: address,
      role: role as string,
      rightType: rightType as string,
      work,
      urls: JSON.stringify(urls),
      detail,
      shares: JSON.stringify(nos),
      memberId,
      events: JSON.stringify([{ at, by: "通知人", action: "送出通知" } satisfies Event]),
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: takedownNotices.id });
  return { id: row.id };
}

/* ---------- 會員：看通知、送回復通知 ---------- */

export async function noticeForMember(u: User, id: number) {
  const [n] = await getDb().select().from(takedownNotices).where(eq(takedownNotices.id, id));
  if (!n || n.memberId !== u.id || n.status === "pending") throw new HttpError(404, "NOT_FOUND", "找不到這則通知");
  return {
    id: n.id,
    status: n.status,
    statusText: TAKEDOWN_STATUS[n.status] ?? n.status,
    claimant: n.claimantName,
    rightType: RIGHT_TYPES[n.rightType as RightType] ?? n.rightType,
    work: n.work,
    detail: n.detail,
    urls: parse<string[]>(n.urls, []),
    counterAt: n.counterAt,
    canCounter: n.status === "removed",
  };
}

export async function submitCounter(u: User, id: number, b: Record<string, unknown>) {
  const text = clip(b.text, 2000);
  if (!text) throw new HttpError(400, "INVALID", "寫明你認為沒有侵權的理由");
  if (b.sworn !== true) throw new HttpError(400, "INVALID", "勾選聲明所述屬實");
  const db = getDb();
  const [n] = await db.select().from(takedownNotices).where(eq(takedownNotices.id, id));
  if (!n || n.memberId !== u.id) throw new HttpError(404, "NOT_FOUND", "找不到這則通知");
  if (n.status !== "removed") throw new HttpError(409, "DONE", "這則通知現在不能提出回復通知");
  const at = nowIso();
  const events = [...parse<Event[]>(n.events, []), { at, by: `@${u.handle}`, action: "會員送出回復通知" }];
  await db
    .update(takedownNotices)
    .set({ status: "counter", counterText: text, counterAt: at, updatedAt: at, events: JSON.stringify(events) })
    .where(and(eq(takedownNotices.id, id), eq(takedownNotices.status, "removed")));
  return { ok: true };
}

/* ---------- 管理員 ---------- */

export type AdminNotice = {
  id: number;
  status: string;
  statusText: string;
  createdAt: string;
  updatedAt: string;
  claimant: { name: string; email: string; phone: string; address: string; role: string };
  rightType: string;
  work: string;
  detail: string;
  urls: string[];
  shares: number[];
  member: { id: string; handle: string; name: string; strikes: number; status: string } | null;
  multiAuthor: boolean;
  counterText: string | null;
  counterAt: string | null;
  forwardedAt: string | null;
  restoreDue: string | null;
  /** 已轉送且過了通知人提出起訴證明的期限 */
  overdue: boolean;
  strike: boolean;
  events: Event[];
};

export async function adminNotices(): Promise<AdminNotice[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(takedownNotices)
    .where(sql`${takedownNotices.status} IN ('pending','removed','counter','forwarded') OR ${takedownNotices.id} IN (SELECT id FROM takedown_notices ORDER BY id DESC LIMIT 50)`)
    .orderBy(desc(takedownNotices.id));
  const memberIds = rows.map((r) => r.memberId ?? "").filter(Boolean);
  const members = memberIds.length
    ? await db.select({ id: users.id, handle: users.handle, name: users.name, strikes: users.copyrightStrikes, status: users.status }).from(users).where(inArray(users.id, [...new Set(memberIds)].slice(0, 90)))
    : [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const allNos = [...new Set(rows.flatMap((r) => parse<number[]>(r.shares, [])))].slice(0, 90);
  const authors = allNos.length ? await db.select({ no: shares.no, a: shares.authorId }).from(shares).where(inArray(shares.no, allNos)) : [];
  const authorOf = new Map(authors.map((x) => [x.no, x.a]));
  return rows.map((r) => {
    const nos = parse<number[]>(r.shares, []);
    return {
      id: r.id,
      status: r.status,
      statusText: TAKEDOWN_STATUS[r.status] ?? r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      claimant: { name: r.claimantName, email: r.claimantEmail, phone: r.claimantPhone, address: r.claimantAddress, role: ROLES[r.role as keyof typeof ROLES] ?? r.role },
      rightType: RIGHT_TYPES[r.rightType as RightType] ?? r.rightType,
      work: r.work,
      detail: r.detail,
      urls: parse<string[]>(r.urls, []),
      shares: nos,
      member: r.memberId && byId.get(r.memberId) ? byId.get(r.memberId)! : null,
      multiAuthor: new Set(nos.map((n) => authorOf.get(n)).filter(Boolean)).size > 1,
      counterText: r.counterText,
      counterAt: r.counterAt,
      forwardedAt: r.forwardedAt,
      restoreDue: r.restoreDue,
      overdue: r.status === "forwarded" && Boolean(r.restoreDue) && Date.parse(r.restoreDue!) < Date.now(),
      strike: r.strike === 1,
      events: parse<Event[]>(r.events, []),
    };
  });
}

export async function openNoticeCount() {
  const [r] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(takedownNotices)
    .where(inArray(takedownNotices.status, ["pending", "counter"]));
  return r?.n ?? 0;
}

async function send(to: string, subject: string, text: string) {
  try {
    await getMailer().send({ to, subject, text });
    return true;
  } catch {
    return false;
  }
}

const twDate = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

/**
 * 管理員操作。action：
 *   remove（隱藏網址對到的收藏＋寄信給會員）｜removed_manual（已在別處手動移除＋寄信給會員）｜reject（不成立，要寫原因）｜
 *   forward（把回復通知轉寄給通知人，開始算 10 個工作日）｜restore（回復內容）｜uphold（通知人已起訴，維持移除）｜
 *   strike（計入會員侵權次數，達上限自動停權）｜note（只記備註）
 */
export async function handleNotice(admin: User, id: number, action: unknown, rawNote: unknown, origin: string) {
  const note = clip(rawNote, 1000);
  const db = getDb();
  const [n] = await db.select().from(takedownNotices).where(eq(takedownNotices.id, id));
  if (!n) throw new HttpError(404, "NOT_FOUND", "找不到這則通知");
  const at = nowIso();
  const by = `@${admin.handle}`;
  const events = parse<Event[]>(n.events, []);
  const nos = parse<number[]>(n.shares, []);
  const urls = parse<string[]>(n.urls, []);
  const set: Partial<typeof takedownNotices.$inferInsert> = { updatedAt: at };
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new HttpError(409, "BAD_STATE", msg);
  };
  let logText = "";

  if (action === "remove" || action === "removed_manual") {
    need(n.status === "pending", "這則通知已經處理過");
    if (action === "remove") {
      need(nos.length > 0, "網址裡沒有本站收藏（/share/N），請到「審核與下架」手動處理後按「已手動移除」");
      await db.update(shares).set({ hiddenAt: at }).where(and(inArray(shares.no, nos), isNull(shares.hiddenAt)));
      for (const no of nos) await db.insert(adminLog).values({ adminId: admin.id, action: "隱藏", target: `share:${no}`, detail: JSON.stringify({ takedown: id }) });
    }
    set.status = "removed";
    events.push({ at, by, action: action === "remove" ? `移除內容（隱藏收藏 ${nos.map((x) => `#${x}`).join("、")}）` : "已手動移除內容", note });
    let mailed = "沒有對到會員，沒寄信";
    if (n.memberId) {
      const [m] = await db.select({ email: users.email, handle: users.handle, status: users.status }).from(users).where(eq(users.id, n.memberId));
      if (m && m.status !== "deleted") {
        const ok = await send(
          m.email,
          `${SITE_NAME}：你的內容因權利侵害通知已先移除（通知 #${id}）`,
          [
            `@${m.handle} 你好，`,
            ``,
            `我們收到一則權利侵害通知，指稱下列內容侵害他人的${RIGHT_TYPES[n.rightType as RightType] ?? "權利"}：`,
            ...urls.map((u) => `・${u}`),
            ``,
            `通知人：${n.claimantName}`,
            `作品或權利：${n.work}`,
            `侵害情形：${n.detail}`,
            ``,
            `依使用條款第 11 條，這些內容已先移除。你認為沒有侵權，可以登入後到下面的網址提出回復通知，寫明理由：`,
            `${origin}/takedown/counter?id=${id}`,
            `我們會把回復通知轉給通知人；對方在收到後 ${RESTORE_WORKDAYS} 個工作日內沒有提出已經起訴的證明，我們會回復該內容。`,
            ``,
            `經確認侵害他人著作權達三次，帳號會被終止全部服務。`,
            `有問題請寄信到 ${CONTACT_EMAIL}`,
          ].join("\n"),
        );
        mailed = ok ? `已寄信通知 @${m.handle}` : `寄信給 @${m.handle} 失敗，請手動通知`;
      }
    }
    events.push({ at, by: "系統", action: mailed });
    logText = "權利侵害通知：移除內容";
  } else if (action === "reject") {
    need(n.status === "pending", "這則通知已經處理過");
    if (!note) throw new HttpError(400, "INVALID", "寫一下不成立的原因");
    set.status = "rejected";
    events.push({ at, by, action: "通知不成立", note });
    logText = "權利侵害通知：不成立";
  } else if (action === "forward") {
    need(n.status === "counter" && Boolean(n.counterText), "會員還沒提出回復通知");
    const due = addWorkdays(new Date(), RESTORE_WORKDAYS);
    const ok = await send(
      n.claimantEmail,
      `${SITE_NAME}：權利侵害通知 #${id} 的回復通知`,
      [
        `${n.claimantName} 你好，`,
        ``,
        `你在 ${twDate(n.createdAt)} 提出的權利侵害通知 #${id}，被通知的會員提出回復通知，認為沒有侵權，內容如下：`,
        ``,
        n.counterText ?? "",
        ``,
        `依著作權法第 90 條之 10，請在收到這封信後 ${RESTORE_WORKDAYS} 個工作日內（${twDate(due)} 前），把已經對該會員提起訴訟的證明寄到 ${CONTACT_EMAIL}。`,
        `期滿沒有收到，我們會回復該內容。`,
      ].join("\n"),
    );
    set.status = "forwarded";
    set.forwardedAt = at;
    set.restoreDue = due;
    events.push({ at, by, action: `轉送回復通知給通知人（${ok ? "已寄信" : "寄信失敗，請手動寄"}），期限 ${twDate(due)}`, note });
    logText = "權利侵害通知：轉送回復通知";
  } else if (action === "restore") {
    need(n.status === "forwarded", "轉送回復通知之後才能回復");
    if (nos.length) {
      await db.update(shares).set({ hiddenAt: null }).where(inArray(shares.no, nos));
      for (const no of nos) await db.insert(adminLog).values({ adminId: admin.id, action: "恢復", target: `share:${no}`, detail: JSON.stringify({ takedown: id }) });
    }
    set.status = "restored";
    events.push({ at, by, action: nos.length ? `回復內容（收藏 ${nos.map((x) => `#${x}`).join("、")} 取消隱藏）` : "回復內容（其他網址請手動恢復）", note });
    logText = "權利侵害通知：回復內容";
  } else if (action === "uphold") {
    need(n.status === "forwarded", "轉送回復通知之後才能選這個");
    set.status = "upheld";
    events.push({ at, by, action: "通知人已提出起訴證明，維持移除", note });
    logText = "權利侵害通知：維持移除";
  } else if (action === "strike") {
    need(["removed", "upheld"].includes(n.status), "內容移除後（且沒有回復）才能計入侵權次數");
    need(n.strike === 0, "這則通知已經計入過");
    need(Boolean(n.memberId), "這則通知沒有對到會員");
    await db.update(users).set({ copyrightStrikes: sql`${users.copyrightStrikes} + 1` }).where(eq(users.id, n.memberId!));
    const [m] = await db.select({ strikes: users.copyrightStrikes, handle: users.handle, status: users.status }).from(users).where(eq(users.id, n.memberId!));
    set.strike = 1;
    events.push({ at, by, action: `計入侵權次數（@${m?.handle} 累計 ${m?.strikes ?? "?"} 次）`, note });
    if (m && m.strikes >= STRIKE_LIMIT && m.status === "active") {
      try {
        await setMemberStatus(admin, n.memberId!, "suspend", "copyright", `權利侵害通知 #${id}`);
        events.push({ at, by: "系統", action: `累計 ${m.strikes} 次，已停權` });
      } catch (e) {
        events.push({ at, by: "系統", action: `累計 ${m.strikes} 次，自動停權失敗：${(e as Error).message}，請到會員頁手動停權` });
      }
    }
    logText = "權利侵害通知：計入侵權次數";
  } else if (action === "note") {
    if (!note) throw new HttpError(400, "INVALID", "寫一下備註");
    events.push({ at, by, action: "備註", note });
    logText = "權利侵害通知：備註";
  } else {
    throw new HttpError(400, "BAD_REQUEST", "參數不對");
  }
  set.events = JSON.stringify(events);
  await db.update(takedownNotices).set(set).where(eq(takedownNotices.id, id));
  await db.insert(adminLog).values({ adminId: admin.id, action: logText, target: `takedown:${id}`, detail: JSON.stringify({ note }) });
  return { ok: true };
}
