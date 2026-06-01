// IMI PRO 아이콘 — 배경 없음, IMI 붙임 로고만 (그라데이션)
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

// ── IMI 붙임 로고 글리프 (15×9) — I·M·I 이어진 하나의 심볼 ─
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

// ── 픽셀 그라데이션 색상 계산 ──────────────────────────────
// 글자 위: 밝은 하늘색(#7dd3fc) → 아래: 진한 파랑(#0284c7)
function letterColor(row, totalRows) {
    const t = totalRows <= 1 ? 0 : row / (totalRows - 1);
    return [
        Math.round(125*(1-t) +  2*t),   // R
        Math.round(211*(1-t) +132*t),   // G
        Math.round(252*(1-t) +199*t),   // B
    ];
}

// ── 글리프 그리기 (픽셀마다 그라데이션) ──────────────────────
function drawCombined(img, W, H, glyph, x0, y0, scale) {
    const rows=glyph.length;
    glyph.forEach((row, ry) => {
        const [r,g,b]=letterColor(ry, rows);
        [...row].forEach((bit, cx) => {
            if(bit!=='1') return;
            for(let sy=0; sy<scale; sy++){
                const [ri,gi,bi]=letterColor(ry*scale+sy, rows*scale);
                for(let sx=0; sx<scale; sx++){
                    const px=x0+cx*scale+sx, py=y0+ry*scale+sy;
                    if(px<0||px>=W||py<0||py>=H) continue;
                    const i=(py*W+px)*4;
                    img[i]=ri; img[i+1]=gi; img[i+2]=bi; img[i+3]=255;
                }
            }
        });
    });
}

// ── 아이콘 PNG 생성 (투명 배경) ────────────────────────────
function createIconPNG(size) {
    const W=size, H=size;
    const img=new Uint8Array(W*H*4); // 전체 투명

    if(size>=32){
        const gW=IMI_GLYPH[0].length; // 15
        const gH=IMI_GLYPH.length;    // 9
        // 아이콘의 80% 너비를 채우는 스케일
        const scale=Math.max(1, Math.floor(size*0.82/gW));
        const tW=gW*scale, tH=gH*scale;
        const sx=Math.round((W-tW)/2), sy=Math.round((H-tH)/2);
        drawCombined(img,W,H,IMI_GLYPH,sx,sy,scale);
    } else {
        // 16px: 미니 9×5
        const gW=IMI_MINI[0].length;
        const gH=IMI_MINI.length;
        const sx=Math.round((W-gW)/2), sy=Math.round((H-gH)/2);
        drawCombined(img,W,H,IMI_MINI,sx,sy,1);
    }

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
