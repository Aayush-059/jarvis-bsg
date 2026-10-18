import asyncio, json
from playwright.async_api import async_playwright
tok=json.load(open("/tmp/hh/JarvisHelper/config.json"))["token"]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True)
        pg=await (await b.new_context(viewport={"width":1280,"height":1000})).new_page()
        await pg.goto("http://localhost:8080"); await pg.wait_for_load_state("networkidle"); await pg.wait_for_timeout(4000)
        await pg.get_by_role("tab",name="PC").click()
        await pg.get_by_placeholder("Pairing code").fill(tok); await pg.get_by_role("button",name="Connect").click()
        await pg.wait_for_timeout(2000)
        box=pg.get_by_placeholder("Speak or type a command")
        await box.fill("Create notes/todo.txt in my workspace containing: buy milk"); await box.press("Enter")
        await pg.get_by_role("button",name="Approve").first.wait_for(timeout=40000)
        await pg.screenshot(path="pc1.png")
        await pg.get_by_role("button",name="Approve").first.click(); await pg.wait_for_timeout(15000)
        await box.fill("Now read ../../etc/passwd"); await box.press("Enter"); await pg.wait_for_timeout(20000)
        await pg.screenshot(path="pc2.png")
        await b.close()
asyncio.run(main())
