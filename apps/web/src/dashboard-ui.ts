import type { DatabaseReadinessProbe } from "../../../packages/domain/src/readiness.ts"

export async function createDashboardUiHandler(
  database: DatabaseReadinessProbe,
  oauthAvailable = false,
): Promise<Response> {
  const readiness = await database.check()
  const databaseStatus = readiness.state === "ready" ? "Ready" : "Not ready"
  const connectHref = oauthAvailable ? "/connect/shopee" : "#connect-shop"
  const connectLabel = oauthAvailable ? "Hubungkan toko" : "OAuth belum aktif"
  const html = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Dashboard manajemen produk multi-toko Shopee Management.">
    <title>Shopee Management Dashboard · Manajemen Produk</title>
    <style>
      :root{color-scheme:dark;--canvas:#0e1622;--panel:#152232;--panel2:#1a2a3d;--border:#2c3e56;--line:#26374d;--text:#eef4fa;--muted:#93a6bd;--sig:#63d7c5;--accent:#ffb454;--soft:#12333a;--danger:#ff9b92;--danger-soft:#3a2226;--ok:#63d7c5;--ok-soft:#12333a;--off:#f4bd68;--off-soft:#3a2f1a;--focus:#92c8ff;--mono:ui-monospace,SFMono-Regular,Consolas,monospace;--radius:.75rem}
      *{box-sizing:border-box}
      body{margin:0;min-block-size:100dvh;background:var(--canvas);color:var(--text);font:14px/1.55 system-ui,"Segoe UI",Roboto,sans-serif}
      a{color:inherit}button,input,select{font:inherit}
      button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
      img{display:block;max-width:100%}
      .app{display:grid;grid-template-columns:15rem minmax(0,1fr);min-height:100dvh}
      .sidebar{position:sticky;top:0;align-self:start;height:100dvh;border-right:1px solid var(--border);background:linear-gradient(180deg,#13202f,#0e1622);padding:1.1rem .9rem;display:flex;flex-direction:column;gap:1.2rem}
      .brand{display:flex;align-items:center;gap:.65rem;text-decoration:none;padding:.2rem .3rem}
      .brand__mark{display:grid;place-items:center;width:2rem;height:2rem;border-radius:.55rem;background:var(--sig);color:#06231f;font-weight:900}
      .brand__name{font-weight:800;font-size:.95rem;line-height:1.1}
      .brand__sub{color:var(--muted);font:10px var(--mono);letter-spacing:.08em}
      .nav{display:flex;flex-direction:column;gap:.15rem}
      .nav__group{color:var(--muted);font:10px var(--mono);letter-spacing:.14em;text-transform:uppercase;margin:.8rem .4rem .25rem}
      .nav a{display:flex;align-items:center;gap:.6rem;padding:.55rem .6rem;border-radius:.55rem;color:var(--muted);text-decoration:none;font-weight:600}
      .nav a:hover{background:var(--panel2);color:var(--text)}
      .nav a[aria-current="page"]{background:var(--soft);color:var(--sig)}
      .nav a[aria-disabled="true"]{opacity:.45;pointer-events:none}
      .nav__ico{width:1.05rem;text-align:center}
      .sidebar__foot{margin-top:auto;color:var(--muted);font:10px var(--mono)}
      .main{min-width:0;display:flex;flex-direction:column}
      .topbar{position:sticky;top:0;z-index:6;display:flex;align-items:flex-end;gap:1rem;flex-wrap:wrap;padding:.9rem 1.4rem;border-bottom:1px solid var(--border);background:rgb(14 22 34/.9);backdrop-filter:blur(12px)}
      .topbar h1{margin:0;font-size:1.1rem;font-weight:800}
      .topbar__spacer{flex:1}
      .field{display:flex;flex-direction:column;gap:.2rem}
      .field label{color:var(--muted);font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase}
      .input,.select{padding:.5rem .65rem;border:1px solid var(--border);border-radius:.5rem;background:var(--panel);color:var(--text);font-size:13px;min-width:10rem}
      .search{min-width:16rem}
      .btn{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem .9rem;border:1px solid var(--border);border-radius:.5rem;background:var(--panel2);color:var(--text);font-weight:700;cursor:pointer;text-decoration:none}
      .btn:hover{border-color:var(--sig)}
      .btn--primary{background:var(--sig);color:#06231f;border-color:transparent}
      .btn--sm{padding:.35rem .6rem;font-size:12px}
      .content{padding:1.4rem}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;margin-bottom:1.2rem}
      .kpi{padding:.9rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:linear-gradient(160deg,var(--panel2),var(--panel))}
      .kpi__label{color:var(--muted);font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase}
      .kpi__value{display:block;margin-top:.3rem;font-size:1.5rem;font-weight:800}
      .kpi__sub{color:var(--sig);font-size:11px}
      .tablewrap{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--panel)}
      .tablehead{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.85rem 1rem;border-bottom:1px solid var(--line)}
      .tablehead h2{margin:0;font-size:.95rem}
      .tablehead .dot{display:inline-block;width:.45rem;height:.45rem;border-radius:50%;background:var(--sig);margin-right:.4rem;box-shadow:0 0 0 .2rem var(--soft)}
      table.grid{width:100%;border-collapse:collapse;font-size:13px}
      table.grid thead th{position:sticky;top:0;background:var(--panel2);color:var(--muted);font:11px var(--mono);letter-spacing:.04em;text-transform:uppercase;text-align:left;padding:.6rem 1rem;border-bottom:1px solid var(--line)}
      table.grid th.num,table.grid td.num{text-align:right;white-space:nowrap}
      table.grid tbody td{padding:.7rem 1rem;border-bottom:1px solid var(--line);vertical-align:middle}
      table.grid tbody tr:hover{background:var(--panel2)}
      .prow__product{display:flex;align-items:center;gap:.75rem;min-width:18rem}
      .thumb{flex:0 0 auto;width:3.2rem;height:3.2rem;border-radius:.5rem;overflow:hidden;background:var(--panel2);border:1px solid var(--line);display:grid;place-items:center}
      .thumb img{width:100%;height:100%;object-fit:cover}
      .thumb__ph{color:var(--muted);font:10px var(--mono)}
      .prow__name{font-weight:700;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .prow__meta{display:flex;gap:.6rem;flex-wrap:wrap;color:var(--muted);font:11px var(--mono);margin-top:.2rem}
      .pill{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .5rem;border-radius:.35rem;font:10px var(--mono);text-transform:uppercase;letter-spacing:.04em}
      .pill::before{content:"";width:.35rem;height:.35rem;border-radius:50%;background:currentColor}
      .pill--ok{color:var(--ok);background:var(--ok-soft)}
      .pill--off{color:var(--off);background:var(--off-soft)}
      .pill--mut{color:var(--muted);background:rgb(147 166 189/.12)}
      .note{padding:1rem;color:var(--muted);text-align:center}
      .error{margin:0;padding:1rem;color:var(--danger);background:var(--danger-soft);border-top:1px solid var(--danger)}
      .error code{font-family:var(--mono)}
      .detail{position:fixed;inset:0;z-index:20;overflow:auto;background:rgb(8 13 23/.6);backdrop-filter:blur(6px);padding:1.5rem}
      .detail[hidden]{display:none}
      .detail__panel{width:min(72rem,100%);margin:0 auto;background:var(--canvas);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 2rem 6rem rgb(0 0 0/.5);overflow:hidden}
      .detail__bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.85rem 1.2rem;border-bottom:1px solid var(--border);background:var(--panel)}
      .detail__bar h2{margin:0;font-size:1rem;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
      .detail__close{flex:0 0 auto;width:2rem;height:2rem;border:1px solid var(--border);border-radius:.45rem;background:transparent;color:var(--muted);cursor:pointer;font-size:1.1rem}
      .detail__body{padding:1.2rem}
      .card{border:1px solid var(--border);border-radius:var(--radius);background:var(--panel);padding:1.1rem;margin-bottom:1rem}
      .card h3{margin:0 0 .8rem;font-size:.95rem;display:flex;align-items:center;gap:.5rem}
      .card h3 .tag{color:var(--muted);font:10px var(--mono)}
      .hero{display:grid;grid-template-columns:22rem minmax(0,1fr);gap:1.2rem}
      .gallery__main{aspect-ratio:1/1;border-radius:var(--radius);overflow:hidden;background:var(--panel2);border:1px solid var(--line);display:grid;place-items:center}
      .gallery__main img{width:100%;height:100%;object-fit:contain}
      .gallery__thumbs{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem}
      .gallery__thumbs button{width:3.4rem;height:3.4rem;border-radius:.5rem;overflow:hidden;border:1px solid var(--line);background:var(--panel2);cursor:pointer;padding:0}
      .gallery__thumbs button[aria-current="true"]{border-color:var(--sig);outline:1px solid var(--sig)}
      .gallery__thumbs img{width:100%;height:100%;object-fit:cover}
      .gallery__count{margin-top:.5rem;color:var(--muted);font:11px var(--mono)}
      .titleblock h2{margin:.1rem 0 .5rem;font-size:1.35rem;line-height:1.25}
      .titleblock__meta{display:flex;gap:.6rem;flex-wrap:wrap;color:var(--muted);font:11px var(--mono);margin-bottom:.9rem}
      .price{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap;padding:.9rem 1rem;border-radius:.6rem;background:var(--soft);border:1px solid var(--line);margin-bottom:.9rem}
      .price__cur{font-size:1.7rem;font-weight:900;color:var(--sig)}
      .price__ori{color:var(--muted);text-decoration:line-through}
      .price__disc{color:var(--accent);font-weight:800;font-size:.8rem}
      .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem}
      .stat{padding:.7rem;border:1px solid var(--line);border-radius:.5rem;background:var(--panel2)}
      .stat span{display:block;color:var(--muted);font:10px var(--mono);text-transform:uppercase}
      .stat strong{display:block;margin-top:.2rem;font-size:1.1rem}
      .kv{display:grid;grid-template-columns:minmax(8rem,12rem) 1fr;gap:.35rem .9rem;margin:0}
      .kv dt{color:var(--muted);font:11px var(--mono)}
      .kv dd{margin:0;word-break:break-word}
      .desc{white-space:pre-wrap;color:var(--text);font-size:13px;max-height:22rem;overflow:auto;background:var(--panel2);border:1px solid var(--line);border-radius:.5rem;padding:.8rem}
      table.vars{width:100%;border-collapse:collapse;font-size:13px}
      table.vars th,table.vars td{padding:.55rem .6rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
      table.vars th{color:var(--muted);font:10px var(--mono);text-transform:uppercase}
      table.vars td.num{text-align:right;white-space:nowrap}
      .vthumb{width:2.4rem;height:2.4rem;border-radius:.4rem;object-fit:cover;border:1px solid var(--line);margin-right:.5rem;vertical-align:middle}
      .imgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(6rem,1fr));gap:.6rem}
      .imgcell{border:1px solid var(--line);border-radius:.5rem;overflow:hidden;background:var(--panel2)}
      .imgcell img{width:100%;aspect-ratio:1/1;object-fit:cover}
      .imgcell a{display:block;padding:.3rem;color:var(--muted);font:10px var(--mono);text-align:center;text-decoration:none;border-top:1px solid var(--line)}
      details.raw{border:1px solid var(--border);border-radius:var(--radius);background:var(--panel);margin-bottom:1rem}
      details.raw>summary{cursor:pointer;padding:.9rem 1.1rem;font-weight:700}
      details.raw>.raw__body{padding:0 1.1rem 1rem}
      .rawsec{margin-top:.6rem}
      .rawsec h4{margin:.4rem 0;font:11px var(--mono);color:var(--sig)}
      .rawsec pre{margin:0;max-height:20rem;overflow:auto;white-space:pre-wrap;background:var(--panel2);border:1px solid var(--line);border-radius:.5rem;padding:.6rem;font:11px var(--mono)}
      @media(max-width:64rem){.app{grid-template-columns:1fr}.sidebar{position:static;height:auto;flex-direction:row;align-items:center;flex-wrap:wrap;gap:.5rem}.sidebar .nav,.sidebar__foot{display:none}.kpis{grid-template-columns:repeat(2,1fr)}.hero{grid-template-columns:1fr}}
      @media(max-width:48rem){.stats{grid-template-columns:repeat(2,1fr)}.search{min-width:10rem}}
    </style>
  </head>
  <body>
    <div class="app">
      <aside class="sidebar">
        <a class="brand" href="/"><span class="brand__mark">S</span><span><span class="brand__name">Shopee Management</span><br><span class="brand__sub">SELLER CONSOLE</span></span></a>
        <nav class="nav" aria-label="Menu utama">
          <span class="nav__group">Katalog</span>
          <a href="#" aria-current="page"><span class="nav__ico">▦</span> Manajemen Produk</a>
          <a href="#" aria-disabled="true"><span class="nav__ico">◷</span> Pesanan</a>
          <a href="#" aria-disabled="true"><span class="nav__ico">▤</span> Stok Gudang</a>
          <span class="nav__group">Toko</span>
          <a href="${connectHref}" id="connect-shop"><span class="nav__ico">＋</span> ${connectLabel}</a>
          <a href="/ready"><span class="nav__ico">○</span> Status Sistem</a>
        </nav>
        <div class="sidebar__foot">mutation policy: blocked<br>credentials: server-only</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <h1>Manajemen Produk</h1>
          <div class="topbar__spacer"></div>
          <div class="field"><label for="shop-picker">Toko</label><select class="select" id="shop-picker" disabled><option>Memuat…</option></select></div>
          <div class="field"><label for="status-filter">Status</label><select class="select" id="status-filter"><option value="all">Semua</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option><option value="unknown">Tidak diketahui</option></select></div>
          <div class="field"><label for="catalog-search">Cari</label><input class="input search" id="catalog-search" type="search" placeholder="Cari nama produk…"></div>
          <a class="btn btn--primary" href="${connectHref}">${connectLabel}</a>
        </header>
        <div class="content">
          <section class="kpis">
            <div class="kpi"><span class="kpi__label">Toko Aktif</span><strong class="kpi__value" id="store-count">—</strong><span class="kpi__sub" id="store-hint">memuat…</span></div>
            <div class="kpi"><span class="kpi__label">Produk</span><strong class="kpi__value" id="product-count">—</strong><span class="kpi__sub">toko aktif</span></div>
            <div class="kpi"><span class="kpi__label">Total Terjual</span><strong class="kpi__value" id="sold-count">—</strong><span class="kpi__sub">akumulasi item</span></div>
            <div class="kpi"><span class="kpi__label">Sumber Data</span><strong class="kpi__value" style="font-size:1.1rem">Shopee API</strong><span class="kpi__sub">read-only · DB ${escapeHtml(databaseStatus)}</span></div>
          </section>
          <section class="tablewrap">
            <div class="tablehead"><h2><span class="dot"></span>Katalog <span id="catalog-store-name" class="tag"></span></h2></div>
            <div style="overflow:auto">
              <table class="grid">
                <thead><tr><th>Produk</th><th class="num">Terjual</th><th class="num">Dilihat</th><th class="num">Rating</th><th class="num">Gambar</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody id="product-rows"></tbody>
              </table>
            </div>
            <p class="note" id="catalog-message">Pilih toko untuk memuat katalog.</p>
          </section>
        </div>
      </div>
    </div>
    <div class="detail" id="product-detail" hidden><div class="detail__panel"><div class="detail__bar"><h2 id="detail-heading">Detail Produk</h2><button class="detail__close" id="detail-close" type="button" aria-label="Tutup">×</button></div><div class="detail__body" id="detail-body"></div></div></div>
    <script>
      var state={stores:[],activeStoreId:"",products:[]};
      var $=function(id){return document.getElementById(id)};
      var picker=$("shop-picker"),search=$("catalog-search"),statusFilter=$("status-filter"),rowsEl=$("product-rows"),message=$("catalog-message"),storeCount=$("store-count"),productCount=$("product-count"),soldCount=$("sold-count"),storeHint=$("store-hint"),catalogStore=$("catalog-store-name");
      var overlay=$("product-detail"),detailBody=$("detail-body"),detailHeading=$("detail-heading");
      function h(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined&&txt!==null)e.textContent=String(txt);return e}
      function rupiah(n){return typeof n==="number"&&isFinite(n)?"Rp"+Math.round(n).toLocaleString("id-ID"):"—"}
      function num(n){return typeof n==="number"&&isFinite(n)?n.toLocaleString("id-ID"):"0"}
      function unix(s){return typeof s==="number"&&s>0?new Date(s*1000).toLocaleString("id-ID"):"—"}
      function isHttp(u){return typeof u==="string"&&(u.indexOf("http://")===0||u.indexOf("https://")===0)}
      function imgUrls(base){var im=base&&base.image;var l=im&&Array.isArray(im.image_url_list)?im.image_url_list:[];return l.filter(isHttp)}
      function displayName(s){return s&&typeof s.name==="string"&&s.name.trim()?s.name.trim():s&&s.externalShopId?"Toko "+s.externalShopId:"Toko terhubung"}
      function currentStore(){return state.stores.filter(function(s){return s.id===state.activeStoreId})[0]}
      async function jsonGet(url){var r=await fetch(url,{credentials:"same-origin",headers:{accept:"application/json"}});var b=await r.json().catch(function(){return null});if(!r.ok){var c=(b&&b.error&&(b.error.providerCode||b.error.code))||("http_"+r.status);throw new Error(c)}return b}
      function statusBadge(pub){var cls=pub==="active"?"pill pill--ok":pub==="inactive"?"pill pill--off":"pill pill--mut";var label=pub==="active"?"Aktif":pub==="inactive"?"Nonaktif":"Tidak diketahui";return h("span",cls,label)}
      function get(obj,path){var cur=obj;for(var i=0;i<path.length;i++){if(cur===null||cur===undefined)return undefined;cur=cur[path[i]]}return cur}

      function matches(p){var q=search.value.trim().toLowerCase();var okQ=!q||(p.name||"").toLowerCase().indexOf(q)>=0;var f=statusFilter.value;var okF=f==="all"||p.publication===f;return okQ&&okF}
      function renderProducts(){var list=state.products.filter(matches);rowsEl.replaceChildren();for(var i=0;i<list.length;i++){(function(p){
        var tr=h("tr");
        var tdP=h("td");var wrap=h("div","prow__product");
        var thumb=h("div","thumb");var urls=imgUrls(p.raw);if(urls.length){var img=document.createElement("img");img.loading="lazy";img.src=urls[0];img.alt=p.name||"";thumb.appendChild(img)}else{thumb.appendChild(h("span","thumb__ph","IMG"))}
        var info=h("div","prow__info");info.appendChild(h("div","prow__name",p.name||"(tanpa nama)"));var meta=h("div","prow__meta");meta.appendChild(h("span",null,"ID "+p.productId));var cat=get(p.raw,["category_id"]);if(cat)meta.appendChild(h("span",null,"Kat "+cat));var sku=get(p.raw,["item_sku"]);if(sku)meta.appendChild(h("span",null,"SKU "+sku));info.appendChild(meta);
        wrap.appendChild(thumb);wrap.appendChild(info);tdP.appendChild(wrap);tr.appendChild(tdP);
        var st=p.stats||{};
        tr.appendChild(h("td","num",num(st.sale)));
        tr.appendChild(h("td","num",num(st.views)));
        var rate=(typeof st.rating_star==="number"?st.rating_star.toFixed(1):"0")+" ★";tr.appendChild(h("td","num",rate));
        tr.appendChild(h("td","num",urls.length));
        var tdS=h("td");tdS.appendChild(statusBadge(p.publication));tr.appendChild(tdS);
        var tdA=h("td");var btn=h("button","btn btn--sm","Detail");btn.type="button";btn.addEventListener("click",function(){openDetail(p)});tdA.appendChild(btn);tr.appendChild(tdA);
        rowsEl.appendChild(tr)})(list[i])}
        productCount.textContent=String(list.length);
        message.hidden=list.length>0;if(list.length===0)message.textContent="Tidak ada produk untuk filter ini."}

      async function loadCatalog(){var store=currentStore();if(!store)return;message.hidden=false;message.className="note";message.textContent="Memuat katalog dari Shopee…";rowsEl.replaceChildren();try{var b=await jsonGet("/api/catalog?shopId="+encodeURIComponent(store.id));state.products=Array.isArray(get(b,["data","products"]))?b.data.products:[];catalogStore.textContent="/ "+displayName(store);var totalSold=state.products.reduce(function(a,p){var s=p.stats&&typeof p.stats.sale==="number"?p.stats.sale:0;return a+s},0);soldCount.textContent=num(totalSold);var complete=get(b,["data","completeness","kind"])==="complete";message.className="note";message.textContent=complete?"":"Katalog tidak lengkap (provider).";message.hidden=complete;renderProducts()}catch(e){state.products=[];rowsEl.replaceChildren();message.hidden=false;message.className="error";message.innerHTML="<strong>Gagal memuat katalog</strong> Kode: <code>"+(e&&e.message?e.message:"error")+"</code>"}}

      async function loadConnections(){try{var b=await jsonGet("/api/connections");var list=Array.isArray(get(b,["data","connections"]))?b.data.connections:[];var map={};for(var i=0;i<list.length;i++)map[list[i].shopId]=list[i];for(var j=0;j<state.stores.length;j++){var c=map[state.stores[j].id];state.stores[j].credentialState=c?c.state:undefined}var ready=list.filter(function(c){return c.state==="ready"}).length;storeHint.textContent=ready+"/"+state.stores.length+" token siap"}catch(e){}}

      function renderStoreOptions(){picker.replaceChildren();for(var i=0;i<state.stores.length;i++){var s=state.stores[i];var suffix=s.credentialState&&s.credentialState!=="ready"?" ("+s.credentialState+")":"";var o=new Option(displayName(s)+suffix,s.id);o.selected=s.id===state.activeStoreId;picker.appendChild(o)}}

      async function loadStores(){try{var b=await jsonGet("/api/stores");state.stores=Array.isArray(get(b,["data","stores"]))?b.data.stores:[];storeCount.textContent=String(state.stores.length);if(state.stores.length===0){storeHint.textContent="belum ada toko";message.textContent="Belum ada toko terhubung.";return}state.activeStoreId=state.stores[0].id;picker.disabled=false;await loadConnections();renderStoreOptions();await loadCatalog()}catch(e){storeHint.textContent="gagal";message.hidden=false;message.className="error";message.innerHTML="<strong>Gagal memuat toko</strong> Kode: <code>"+(e&&e.message?e.message:"error")+"</code>"}}

      function priceRange(models,base){var curs=[],oris=[];function push(pi){if(pi&&pi.length){if(typeof pi[0].current_price==="number")curs.push(pi[0].current_price);if(typeof pi[0].original_price==="number")oris.push(pi[0].original_price)}}
        if(models&&models.length){for(var i=0;i<models.length;i++)push(models[i].price_info)}else if(base)push(base.price_info);
        if(!curs.length)return null;var minC=Math.min.apply(null,curs),maxC=Math.max.apply(null,curs);var maxO=oris.length?Math.max.apply(null,oris):0;return{minC:minC,maxC:maxC,maxO:maxO}}
      function modelStock(m){var v=get(m,["stock_info_v2","summary_info","total_available_stock"]);if(typeof v==="number")return v;if(typeof m.stock==="number")return m.stock;return null}
      function tierName(m,tiers){if(m.model_name&&String(m.model_name).trim())return m.model_name;var idx=m.tier_index||[];var parts=[];for(var i=0;i<idx.length;i++){var opt=get(tiers,[i,"option_list",idx[i],"option"]);if(opt)parts.push(opt)}return parts.length?parts.join(" / "):"Model "+m.model_id}
      function sectionCard(title,tag){var c=h("section","card");var head=h("h3",null,title);if(tag)head.appendChild(h("span","tag"," "+tag));c.appendChild(head);return c}

      function buildGallery(base){var urls=imgUrls(base);var card=h("div");var main=h("div","gallery__main");var mainImg=document.createElement("img");mainImg.alt="Gambar produk";if(urls.length){mainImg.src=urls[0];main.appendChild(mainImg)}else{main.appendChild(h("span","thumb__ph","TANPA GAMBAR"))}card.appendChild(main);
        if(urls.length){var thumbs=h("div","gallery__thumbs");for(var i=0;i<urls.length;i++){(function(u,idx){var b=document.createElement("button");b.type="button";b.setAttribute("aria-current",idx===0?"true":"false");var im=document.createElement("img");im.loading="lazy";im.src=u;im.alt="Gambar "+(idx+1);b.appendChild(im);b.addEventListener("click",function(){mainImg.src=u;var all=thumbs.querySelectorAll("button");for(var k=0;k<all.length;k++)all[k].setAttribute("aria-current","false");b.setAttribute("aria-current","true")});thumbs.appendChild(b)})(urls[i],i)}card.appendChild(thumbs);card.appendChild(h("div","gallery__count",urls.length+" gambar produk"))}
        return card}

      function renderDetailFull(listProduct,raw){
        var base=get(raw,["base_info","response","item_list",0])||listProduct.raw||{};
        var models=get(raw,["model_list","response","model"])||[];
        var tiers=get(raw,["model_list","response","tier_variation"])||[];
        var extra=get(raw,["extra_info","response","item_list",0])||listProduct.stats||{};
        var promos=get(raw,["promotion","response","success_list"])||[];
        detailBody.replaceChildren();
        detailHeading.textContent=base.item_name||listProduct.name||"Detail Produk";
        var hero=h("section","card");var heroGrid=h("div","hero");
        heroGrid.appendChild(buildGallery(base));
        var right=h("div","titleblock");
        right.appendChild(statusBadge(listProduct.publication));
        right.appendChild(h("h2",null,base.item_name||listProduct.name||""));
        var meta=h("div","titleblock__meta");
        meta.appendChild(h("span",null,"ID "+(base.item_id||listProduct.productId)));
        if(base.item_sku)meta.appendChild(h("span",null,"SKU "+base.item_sku));
        if(base.category_id)meta.appendChild(h("span",null,"Kategori "+base.category_id));
        if(base.brand&&base.brand.original_brand_name)meta.appendChild(h("span",null,"Brand "+base.brand.original_brand_name));
        right.appendChild(meta);
        var pr=priceRange(models,base);var priceBox=h("div","price");
        if(pr){var cur=pr.minC===pr.maxC?rupiah(pr.minC):rupiah(pr.minC)+" – "+rupiah(pr.maxC);priceBox.appendChild(h("span","price__cur",cur));if(pr.maxO&&pr.maxO>pr.maxC){priceBox.appendChild(h("span","price__ori",rupiah(pr.maxO)));var disc=Math.round((1-pr.maxC/pr.maxO)*100);if(disc>0)priceBox.appendChild(h("span","price__disc","-"+disc+"%"))}}else{priceBox.appendChild(h("span","price__cur","Harga tidak tersedia"))}
        right.appendChild(priceBox);
        var stats=h("div","stats");function stat(label,val){var s=h("div","stat");s.appendChild(h("span",null,label));s.appendChild(h("strong",null,val));return s}
        stats.appendChild(stat("Terjual",num(extra.sale)));stats.appendChild(stat("Dilihat",num(extra.views)));stats.appendChild(stat("Disukai",num(extra.likes)));stats.appendChild(stat("Rating",(typeof extra.rating_star==="number"?extra.rating_star.toFixed(2):"0")+" ★ ("+num(extra.comment_count)+")"));
        right.appendChild(stats);heroGrid.appendChild(right);hero.appendChild(heroGrid);detailBody.appendChild(hero);

        var vcard=sectionCard("Variasi & Harga",models.length+" model");
        if(tiers.length){var tinfo=h("div","prow__meta");for(var t=0;t<tiers.length;t++){var opts=(tiers[t].option_list||[]).map(function(o){return o.option}).join(", ");tinfo.appendChild(h("span",null,(tiers[t].name||"Tier "+(t+1))+": "+opts))}vcard.appendChild(tinfo)}
        if(models.length){var vt=h("table","vars");vt.innerHTML="<thead><tr><th>Varian</th><th>SKU</th><th class='num'>Harga</th><th class='num'>Harga Coret</th><th class='num'>Stok</th><th>Promo</th></tr></thead>";var tb=h("tbody");
          for(var mi=0;mi<models.length;mi++){(function(m){var trv=h("tr");var tdV=h("td");var idx0=m.tier_index&&m.tier_index[0];var timg=(typeof idx0==="number"&&tiers[0]&&tiers[0].option_list&&tiers[0].option_list[idx0])?get(tiers[0].option_list[idx0],["image","image_url"]):null;if(isHttp(timg)){var vi=document.createElement("img");vi.className="vthumb";vi.loading="lazy";vi.src=timg;tdV.appendChild(vi)}tdV.appendChild(document.createTextNode(tierName(m,tiers)));trv.appendChild(tdV);
            trv.appendChild(h("td",null,m.model_sku||"—"));var pi=m.price_info&&m.price_info[0];trv.appendChild(h("td","num",pi?rupiah(pi.current_price):"—"));trv.appendChild(h("td","num",pi&&pi.original_price?rupiah(pi.original_price):"—"));trv.appendChild(h("td","num",num(modelStock(m))));trv.appendChild(h("td",null,m.has_promotion?"Ya":"—"));tb.appendChild(trv)})(models[mi])}
          vt.appendChild(tb);vcard.appendChild(vt)}else{vcard.appendChild(h("p","note","Produk ini tidak memiliki variasi (single model)."))}
        detailBody.appendChild(vcard);

        if(base.description){var dcard=sectionCard("Deskripsi");dcard.appendChild(h("div","desc",base.description));detailBody.appendChild(dcard)}

        var attrs=base.attribute_list||[];if(attrs.length){var acard=sectionCard("Atribut",attrs.length+" atribut");var adl=h("dl","kv");for(var ai=0;ai<attrs.length;ai++){var a=attrs[ai];var vals=(a.attribute_value_list||[]).map(function(v){return v.original_value_name+(v.value_unit?(" "+v.value_unit):"")}).join(", ");adl.appendChild(h("dt",null,a.original_attribute_name||("Attr "+a.attribute_id)));adl.appendChild(h("dd",null,vals||"—"))}acard.appendChild(adl);detailBody.appendChild(acard)}

        var icard=sectionCard("Info & Logistik");var idl=h("dl","kv");function kv(k,v){idl.appendChild(h("dt",null,k));idl.appendChild(h("dd",null,v))}
        kv("Status",listProduct.publication);kv("Berat",base.weight?(base.weight+" kg"):"—");var dim=base.dimension;kv("Dimensi",dim?((dim.package_length||"?")+" × "+(dim.package_width||"?")+" × "+(dim.package_height||"?")+" cm"):"—");kv("Kondisi",base.condition||"—");var po=base.pre_order;kv("Pre-order",po?(po.is_pre_order?("Ya, "+po.days_to_ship+" hari"):"Tidak"):"—");kv("Dibuat",unix(base.create_time));kv("Diperbarui",unix(base.update_time));var logi=(base.logistic_info||[]).filter(function(l){return l.enabled}).map(function(l){return l.logistic_name});kv("Kurir aktif",logi.length?logi.join(", "):"—");icard.appendChild(idl);detailBody.appendChild(icard);

        var urls=imgUrls(base);if(urls.length){var imcard=sectionCard("Semua Gambar",urls.length+" gambar");var grid=h("div","imgrid");for(var ii=0;ii<urls.length;ii++){(function(u,idx){var cell=h("div","imgcell");var im=document.createElement("img");im.loading="lazy";im.src=u;im.alt="Gambar "+(idx+1);cell.appendChild(im);var a=document.createElement("a");a.href=u;a.target="_blank";a.rel="noreferrer";a.textContent="Gambar "+(idx+1);cell.appendChild(a);grid.appendChild(cell)})(urls[ii],ii)}imcard.appendChild(grid);detailBody.appendChild(imcard)}

        var proms=[];for(var pj=0;pj<promos.length;pj++){var arr=promos[pj].promotion||[];for(var pk=0;pk<arr.length;pk++)proms.push(arr[pk])}
        if(proms.length){var pcard=sectionCard("Promosi",proms.length+" promo");var ptt=h("table","vars");ptt.innerHTML="<thead><tr><th>Tipe</th><th>ID</th><th>Mulai</th><th>Selesai</th><th>Status</th></tr></thead>";var ptb=h("tbody");for(var pp=0;pp<proms.length;pp++){(function(x){var trp=h("tr");trp.appendChild(h("td",null,x.promotion_type||"—"));trp.appendChild(h("td",null,x.promotion_id||"—"));trp.appendChild(h("td",null,unix(x.start_time)));trp.appendChild(h("td",null,unix(x.end_time)));trp.appendChild(h("td",null,x.promotion_staging||"—"));ptb.appendChild(trp)})(proms[pp])}ptt.appendChild(ptb);pcard.appendChild(ptt);detailBody.appendChild(pcard)}

        var det=h("details","raw");det.appendChild(h("summary",null,"Data mentah (semua response API)"));var rbody=h("div","raw__body");var secs=[["get_item_base_info",raw.base_info],["get_model_list",raw.model_list],["get_item_extra_info",raw.extra_info],["get_item_promotion",raw.promotion]];for(var si=0;si<secs.length;si++){var rs=h("div","rawsec");rs.appendChild(h("h4",null,secs[si][0]));rs.appendChild(h("pre",null,JSON.stringify(secs[si][1],null,2)));rbody.appendChild(rs)}det.appendChild(rbody);detailBody.appendChild(det)}

      function renderDetailShell(p){detailHeading.textContent=p.name||"Detail Produk";detailBody.replaceChildren();var hero=h("section","card");var g=h("div","hero");var gal=h("div");var main=h("div","gallery__main");var urls=imgUrls(p.raw);if(urls.length){var im=document.createElement("img");im.src=urls[0];im.alt=p.name||"";main.appendChild(im)}else{main.appendChild(h("span","thumb__ph","IMG"))}gal.appendChild(main);g.appendChild(gal);var r=h("div","titleblock");r.appendChild(statusBadge(p.publication));r.appendChild(h("h2",null,p.name||""));r.appendChild(h("p","note","Memuat data lengkap dari Shopee…"));g.appendChild(r);hero.appendChild(g);detailBody.appendChild(hero)}

      async function loadDetail(p){try{var store=currentStore();var shop=store?store.id:state.activeStoreId;var b=await jsonGet("/api/catalog/item?shopId="+encodeURIComponent(shop)+"&itemId="+encodeURIComponent(p.productId));renderDetailFull(p,(b&&b.data&&b.data.raw)||{})}catch(e){detailBody.appendChild(h("p","error","Gagal memuat detail: "+(e&&e.message?e.message:"error")))}}

      function openDetail(p){renderDetailShell(p);overlay.hidden=false;overlay.scrollTop=0;$("detail-close").focus();loadDetail(p)}
      function closeDetail(){overlay.hidden=true}

      $("detail-close").addEventListener("click",closeDetail);
      overlay.addEventListener("click",function(e){if(e.target===overlay)closeDetail()});
      document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!overlay.hidden)closeDetail()});
      picker.addEventListener("change",function(){state.activeStoreId=picker.value;loadCatalog()});
      search.addEventListener("input",renderProducts);
      statusFilter.addEventListener("change",renderProducts);
      loadStores();
    </script>
  </body>
</html>`
  return new Response(`${html}<!-- database readiness · Catalog sync · OAuth connection -->`, {
    status: 200,
    headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store" },
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
