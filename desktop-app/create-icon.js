// IMI PRO 아이콘 — 파랑→핑크 그라데이션 + 그림자 + 투명 배경
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG 인코더 ─────────────────────────────────────────────
function crc32(buf) {
    const t=new Uint32Array(256);
    for(let i=0;i<256;i++){let k=i;for(let j=0;j<8;j++)k=k&1?(0xEDB88320^(k>>>1)):(k>>>1);t[i]=k;}
    let c=0xFFFFFFFF;
    for(let i=0;i<buf.length;i++) c=t[(c^buf[i])&0xFF]^(c>>>8);
    return (c^0xFFFFFFFF)>>>0;
}
function chunk(type, data) {
    const tb=Buffer.from(type,'ascii'), len=Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body=Buffer.concat([tb,Buffer.from(data)]);
    const cv=Buffer.alloc(4); cv.writeUInt32BE(crc32(body));
    return Buffer.concat([len,body,cv]);
}
function encodePNG(W, H, img) {
    const ihdr=Buffer.alloc(13);
    ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=6;
    const rows=[];
    for(let y=0;y<H;y++){
        const row=Buffer.alloc(1+W*4); row[0]=0;
        for(let x=0;x<W;x++){
            const i=(y*W+x)*4;
            row[1+x*4]=img[i]; row[1+x*4+1]=img[i+1];
            row[1+x*4+2]=img[i+2]; row[1+x*4+3]=img[i+3];
        }
        rows.push(row);
    }
    return Buffer.concat([
        Buffer.from([137,80,78,71,13,10,26,10]),
        chunk('IHDR',ihdr),
        chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),
        chunk('IEND',Buffer.alloc(0))
    ]);
}

// ── IMI 붙임 로고 글리프 (15×9) ────────────────────────────
const IMI_GLYPH = [
    '111111000111111',
    '001001101100100',
    '001001010100100',
    '001001000100100',
    '001001000100100',
    '001001000100100',
    '001001000100100',
    '001001000100100',
    '111111000111111',
];
// 16px 미니 (9×5)
const IMI_MINI = [
    '111101111',
    '010111010',
    '010101010',
    '010101010',
    '111101111',
];

// ── 앱 로고와 동일한 파랑→핑크 그라데이션 (135deg) ──────────
// #0284c7 → #3abff8 → #db2777
function gradColor(t) {
    t = Math.max(0, Math.min(1, t));
    if (t < 0.5) {
        const s = t * 2;
        return [
            Math.round(2   + (58 - 2)   * s),
            Math.round(132 + (191-132)  * s),
            Math.round(199 + (248-199)  * s),
        ];
    } else {
        const s = (t - 0.5) * 2;
        return [
            Math.round(58  + (219-58)   * s),
            Math.round(191 + (39 -191)  * s),
            Math.round(248 + (119-248)  * s),
        ];
    }
}

// ── 픽셀 쓰기 ─────────────────────────────────────────────
function setPixel(img, W, H, x, y, r, g, b, a) {
    if(x<0||x>=W||y<0||y>=H) return;
    const i=(y*W+x)*4;
    const fa=a/255, ba=img[i+3]/255, oa=fa+ba*(1-fa);
    if(oa===0){ img[i+3]=0; return; }
    img[i]  =Math.round((r*fa + img[i]  *ba*(1-fa))/oa);
    img[i+1]=Math.round((g*fa + img[i+1]*ba*(1-fa))/oa);
    img[i+2]=Math.round((b*fa + img[i+2]*ba*(1-fa))/oa);
    img[i+3]=Math.round(oa*255);
}

// ── 글리프 렌더링 (원형 확장으로 굵은 획) ───────────────────
// radius: 각 픽셀을 원형으로 r만큼 확장 → 선 굵기 증가
function renderGlyphColor(img, W, H, glyph, x0, y0, scale, tW, tH, radius, offX, offY, fr, fg, fb, fa) {
    glyph.forEach((row, ry) => {
        [...row].forEach((bit, cx) => {
            if(bit !== '1') return;
            const basePx = cx*scale + scale*0.5;
            const basePy = ry*scale + scale*0.5;
            for(let dy=-radius; dy<=radius; dy++) {
                for(let dx=-radius; dx<=radius; dx++) {
                    if(dx*dx + dy*dy > radius*radius) continue;
                    const px=Math.round(basePx+dx), py=Math.round(basePy+dy);
                    const t=((px/tW)+(py/tH))/2;
                    const [r,g,b] = (fr===-1) ? gradColor(t) : [fr,fg,fb];
                    setPixel(img,W,H, x0+px+offX, y0+py+offY, r,g,b, fa);
                }
            }
        });
    });
}

// ── 아이콘 PNG 생성 (투명 배경) ────────────────────────────
function createIconPNG(size) {
    const W=size, H=size;
    const img=new Uint8Array(W*H*4);

    let glyph, gW, gH, scale, sx, sy;

    if(size >= 32){
        glyph=IMI_GLYPH;
        gW=glyph[0].length; gH=glyph.length;
        scale=Math.max(1, Math.round(size*0.92/gW));
    } else {
        glyph=IMI_MINI;
        gW=glyph[0].length; gH=glyph.length;
        scale=1;
    }

    const tW=gW*scale, tH=gH*scale;
    sx=Math.round((W-tW)/2);
    sy=Math.round((H-tH)/2);

    // 획 굵기: scale 비례로 확장 (크롬 아이콘처럼 꽉 차 보이도록)
    const radius = Math.max(1, Math.round(scale * 0.9));

    // 1) 그림자 (offset + 동일 radius)
    const sOff = Math.max(1, Math.round(scale * 0.5));
    renderGlyphColor(img,W,H,glyph,sx,sy,scale,tW,tH,radius, sOff,sOff, 0,0,0, 130);

    // 2) 글자 본체 — 파랑→핑크 그라데이션 (fr=-1 이면 gradColor 사용)
    renderGlyphColor(img,W,H,glyph,sx,sy,scale,tW,tH,radius, 0,0, -1,0,0, 255);

    return encodePNG(W,H,img);
}

// ── ICO 생성 ──────────────────────────────────────────────
function createICO(sizes) {
    const pngs=sizes.map(s=>createIconPNG(s));
    const header=Buffer.alloc(6);
    header.writeUInt16LE(0,0); header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
    let offset=6+sizes.length*16;
    const entries=pngs.map((png,i)=>{
        const e=Buffer.alloc(16), s=sizes[i];
        e[0]=s>=256?0:s; e[1]=s>=256?0:s;
        e.writeUInt16LE(1,4); e.writeUInt16LE(32,6);
        e.writeUInt32LE(png.length,8); e.writeUInt32LE(offset,12);
        offset+=png.length; return e;
    });
    return Buffer.concat([header,...entries,...pngs]);
}

// ── 저장 ──────────────────────────────────────────────────
const assetsDir=path.join(__dirname,'assets');
if(!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

fs.writeFileSync(path.join(assetsDir,'icon.ico'), createICO([16,32,48,256]));
console.log('icon.ico 생성 완료');
fs.writeFileSync(path.join(assetsDir,'icon.png'), createIconPNG(256));
console.log('icon.png 생성 완료');
