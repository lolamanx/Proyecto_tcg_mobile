const root = 'https://raw.githubusercontent.com/lolamanx/Proyecto_tcg_mobile/main/data/90f27d0/';
export async function loadCatalog() {
  async function read(path) {
    const response = await fetch(root + path);
    if (!response.ok) throw new Error('Catálogo temporalmente inaccesible');
    return response.json();
  }
  const shards = await read('index.json');
  const groups = (await Promise.all(shards.map(read))).flat();
  const cards = groups.flatMap(([setId,setName,total,code,rows]) => rows.map(([id,name,number,image]) =>
    ({id,name,number,image,setId,setName,code,
      total: /^(TG|GG|RC|SV)\d+$/i.test(number) && rows.every(row => row[2].startsWith(number.match(/^[A-Z]+/i)[0]))
        ? number.match(/^[A-Z]+/i)[0] + total : total})));
  return {cards, editions: groups.length};
}
