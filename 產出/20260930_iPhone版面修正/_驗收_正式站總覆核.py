import json
from playwright.sync_api import sync_playwright
ME=json.loads('{"geo":{"country":"TW","canTrade":true},"user":{"id":"u1","email":"t@e.com","handle":"t","name":"測試","bio":"","role":"member","verified":true,"admin":false,"deletionRequested":false,"avatar":null,"nameNextAt":null},"state":{"liked":[],"owned":[],"wanted":[],"follows":[],"reported":[],"appeals":[],"unread":0,"dismissed":[]}}')
with sync_playwright() as p:
  b=p.webkit.launch()
  for w in (390,375,360,320):
    pg=b.new_page(viewport={"width":w,"height":844},device_scale_factor=3)
    pg.route("**/api/me",lambda r:r.fulfill(status=200,content_type="application/json",body=json.dumps(ME)))
    pg.goto("https://lemibox.com/",wait_until="commit",timeout=60000); pg.wait_for_selector(".slot-offer"); pg.wait_for_timeout(2500)
    t=pg.evaluate("()=>[getComputedStyle(document.querySelector('.home-tagline')).display, Math.round(document.querySelector('.home-top').getBoundingClientRect().top-document.querySelector('header').getBoundingClientRect().bottom), document.documentElement.scrollWidth]")
    card=pg.locator(".card",has=pg.locator(".slot-offer")).first; card.scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    if w==390: card.screenshot(path="final_card_webkit390.jpg",type="jpeg",quality=85)
    pg.goto("https://lemibox.com/share/new",wait_until="commit",timeout=60000); pg.wait_for_selector(".drop"); pg.wait_for_timeout(1500)
    d=pg.evaluate("()=>[getComputedStyle(document.querySelector('.drop')).borderLeftWidth, document.documentElement.scrollWidth]")
    print(w,"tagline/gap/scrollW",t,"drop bw/scrollW",d); pg.close()
  b.close()
