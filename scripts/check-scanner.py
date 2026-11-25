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
    browser.close()
