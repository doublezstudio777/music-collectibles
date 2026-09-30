from playwright.sync_api import sync_playwright
import pathlib
from PIL import Image
with sync_playwright() as p:
  for eng in ("webkit","chromium"):
    b=getattr(p,eng).launch()
    for dpr in (1,2,3):
      pg=b.new_page(viewport={"width":390,"height":1400},device_scale_factor=dpr)
      pg.goto("file://"+str(pathlib.Path("_虛線框最小重現.html").resolve()))
      for i in "abcef":
        pg.locator("#"+i).screenshot(path="t.png")
        im=Image.open("t.png").convert("RGB"); w,h=im.size
        L=max(sum(1 for y in range(h) if sum(im.getpixel((x,y)))<500) for x in range(3))
        T=max(sum(1 for x in range(w) if sum(im.getpixel((x,y)))<500) for y in range(3))
        print(eng,dpr,i,"left dark px",L,"/",h,"top",T,"/",w)
    b.close()
