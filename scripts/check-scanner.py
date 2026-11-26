"""Exercise the bundled engine and catalog through the photo input without external services."""
from shutil import which
from playwright.sync_api import sync_playwright

with sync_playwright() as runtime:
    browser = runtime.chromium.launch(executable_path=which('google-chrome') or which('chromium'),args=['--no-sandbox'])
    page = browser.new_page(service_workers='block')
    page.route('https://**', lambda route: route.abort())
    page.route('**/api/reference-image*', lambda route: route.abort())
    page.goto('http://localhost:4173')
    page.wait_for_selector('#catalog-source:enabled',state='attached')
    for name,number,total in [('Zorua','170','264'),('Dark Alakazam','1','82')]:
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1000"><rect width="720" height="1000" fill="white"/><g font-family="sans-serif" fill="black"><text x="50" y="90" font-size="50">{name}</text><text x="50" y="945" font-size="32">{number}/{total}</text></g></svg>'
        page.locator('#photo-input').set_input_files(dict(name='sample.svg',mimeType='image/svg+xml',buffer=svg.encode()))
        page.wait_for_function('name=>document.querySelector("#detected-name").textContent.startsWith(name+" ·")',arg=name,timeout=90000)
        assert f'{number}/{total}' in page.locator('#detected-name').inner_text()
        print('OCR y catálogo incluidos:',page.locator('#detected-name').inner_text())
    # Exercise the actual camera loop with an off-centre, tilted card video.
    camera_page=browser.new_page(service_workers='block')
    camera_page.route('https://**', lambda route: route.abort())
    camera_page.route('**/api/reference-image*', lambda route: route.abort())
    camera_page.add_init_script("""navigator.mediaDevices.getUserMedia=async()=>{
      const scene=document.createElement('canvas');scene.width=1200;scene.height=800;
      const c=scene.getContext('2d');
      function paint(){
        c.fillStyle='#283040';c.fillRect(0,0,1200,800);
        c.save();c.translate(720,120);c.transform(.98,.18,-.12,1,0,0);
        c.fillStyle='#fff';c.fillRect(0,0,315,440);c.fillStyle='#171717';
        c.font='bold 28px sans-serif';c.fillText('Zorua',18,40);
        c.fillStyle='#737f99';c.fillRect(22,66,271,160);
        c.fillStyle='#171717';c.font='20px sans-serif';c.fillText('170/264',17,417);
        c.restore();
      }
      paint();setInterval(paint,120);return scene.captureStream(8);
    }""")
    camera_page.goto('http://localhost:4173')
    camera_page.wait_for_selector('#card-outline polygon[points]',state='attached',timeout=90000)
    camera_page.wait_for_function("document.querySelector('#pending-count').textContent==='1'",timeout=90000)
    assert 'Zorua · 170/264' in camera_page.locator('#detected-name').inner_text()
    corners=camera_page.locator('#card-outline polygon').get_attribute('points')
    assert min(float(p.split(',')[0]) for p in corners.split())>600
    print('Camera loop: off-centre tilted Zorua 170/264 in pending; corners',corners)
    quads=camera_page.evaluate("""async()=>{
      const {loadDetector,locate}=await import('/detector.js');const {cv}=await loadDetector();
      const c=document.createElement('canvas');c.width=960;c.height=720;const ctx=c.getContext('2d');
      ctx.fillStyle='#242629';ctx.fillRect(0,0,960,720);
      if(locate(cv,c))throw Error('False contour on blank frame');
      ctx.fillStyle='white';ctx.beginPath();ctx.moveTo(32,70);ctx.lineTo(340,120);
      ctx.lineTo(290,570);ctx.lineTo(65,520);ctx.closePath();ctx.fill();
      return locate(cv,c);
    }""")
    assert quads and abs(quads[0]['x']*960-32)<12
    browser.close()
