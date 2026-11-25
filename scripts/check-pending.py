from shutil import which
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=which('google-chrome') or which('chromium'),args=['--no-sandbox'])
 ctx=b.new_context(service_workers='block')
 page=ctx.new_page()
 page.route('https://**',lambda r:r.abort())
 page.route('**/api/reference-image*',lambda r:r.abort())
 page.add_init_script("window.Tesseract={createWorker:async()=>({recognize:async()=>({data:{text:'Pikachu 58/102 Basic Weakness',confidence:99}})})}")
 page.goto('http://localhost:4173')
 page.wait_for_selector('#catalog-source:enabled',state='attached')
 for n in [1,2]:
  page.locator('#photo-input').set_input_files({'name':'card.svg','mimeType':'image/svg+xml','buffer':b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" fill="gray"/></svg>'})
  page.wait_for_function('n=>document.querySelector("#pending-count").textContent===String(n)',arg=n)
 page.reload()
 page.click('[data-page=pending]')
 rows=page.locator('#pending-list button')
 assert rows.count()==2
 rows.first.click()
 page.select_option('[name=finish]','normal')
 page.click('#card-form button[type=submit]')
 page.get_by_text('Revisar siguiente',exact=True).click()
 page.get_by_text('Descartar esta lectura',exact=True).click()
 assert rows.count()==0
 page.click('[data-page=collection]')
 assert page.locator('#collection-total').inner_text()=='1'
 print('Dos lecturas, recarga, confirmar una, revisar siguiente, descartar otra: correcto.')
