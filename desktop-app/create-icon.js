// IMI PRO 아이콘 생성 — ICO (16/32/48/256) + PNG (256)
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG 인코더 ─────────────────────────────────────────────
function crc32(buf) {
    const t = new Uint32Array(256);
    for (let i=0;i<256;i++){let k=i;for(let j=0;j<8;j++)k=k&1?(0xEDB88320^(k>>>1)):(k>>>1);t[i]=k;}
    let c = 0xFFFFFFFF;
    for (let i=0; i<buf.length; i++) c = t[(c^buf[i])&0xFF]^(c>>>8);
    return (c^0xFFFFFFFF)>>>0;
}
function chunk(type, data) {
    const tb=Buffer.from(type,'ascii'), len=Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body=Buffer.concat([tb,Buffer.from(data)]);
    const crcVal=Buffer.alloc(4); crcVal.writeUInt32BE(crc32(body));
    return Buffer.concat([len,body,crcVal]);
}
function encodePNG(W, H, img) {
    const ihdr=Buffer.alloc(13);
    ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
    ihdr[8]=8; ihdr[9]=6;
    const rows=[];
    for (let y=0;y<H;y++){
        const row=Buffer.alloc(1+W*4); row[0]=0;
        for(let x=0;x<W;x++){
            const i=(y*W+x)*4;
            row[1+x*4]=img[i];row[1+x*4+1]=img[i+1];
            row[1+x*4+2]=img[i+2];row[1+x*4+3]=img[i+3];
        }
        rows.push(row);
    }
    const compressed=zlib.deflateSync(Buffer.concat(rows));
    return Buffer.concat([
        Buffer.from([137,80,78,71,13,10,26,10]),
        chunk('IHDR',ihdr), chunk('IDAT',compressed), chunk('IEND',Buffer.alloc(0))
    ]);
}

// ── 픽셀 조작 ─────────────────────────────────────────────
function setPixel(img, W, H, x, y, r, g, b, a=255) {
    if (x<0||x>=W||y<0||y>=H) return;
    const i=(y*W+x)*4;
    img[i]=r; img[i+1]=g; img[i+2]=b; img[i+3]=a;
}

// 5×9 픽셀 폰트
const GLYPHS = {
    I: ['11111','00100','00100','00100','00100','00100','00100','00100','11111'],
    M: ['10001','11011','10101','10001','10001','10001','10001','10001','10001'],
};

function drawGlyph(img, W, H, ch, x0, y0, scale) {
    const rows=GLYPHS[ch]; if(!rows) return;
    rows.forEach((row,ry)=>{
        [...row].forEach((bit,cx)=>{
            if(bit!=='1') return;
            for(let sy=0;sy<scale;sy++)
                for(let sx=0;sx<scale;sx++)
                    setPixel(img,W,H, x0+cx*scale+sx, y0+ry*scale+sy, 255,255,255);
        });
    });
}

// ── 아이콘 PNG 생성 ────────────────────────────────────────
function createIconPNG(size) {
    const W=size, H=size;
    const img=new Uint8Array(W*H*4); // 기본 투명

    // 라운드 사각형 채우기 — 파란색 (#1e40af)
    const margin = Math.max(1, Math.round(size*0.04));
    const rc     = Math.max(2, Math.round(size*0.18)); // corner radius
    const BG = [30, 64, 175];

    for (let y=margin; y<H-margin; y++) {
        for (let x=margin; x<W-margin; x++) {
            const inL = x-margin < rc, inR = W-margin-1-x < rc;
            const inT = y-margin < rc, inB = H-margin-1-y < rc;
            if ((inL||inR) && (inT||inB)) {
                const cx = inL ? margin+rc : W-margin-rc;
                const cy = inT ? margin+rc : H-margin-rc;
                const dx = x-cx+0.5, dy = y-cy+0.5;
                if (dx*dx + dy*dy > rc*rc) continue;
            }
            const i=(y*W+x)*4;
            img[i]=BG[0]; img[i+1]=BG[1]; img[i+2]=BG[2]; img[i+3]=255;
        }
    }

    // IMI 텍스트 배치
    if (size >= 48) {
        const scale = size<=56?2 : size<=96?3 : Math.round(size/48)*2;
        const GW=5*scale, GH=9*scale, GAP=Math.max(scale, 2);
        const tW=GW*3+GAP*2;
        const sx=Math.floor((W-tW)/2), sy=Math.floor((H-GH)/2);
        drawGlyph(img,W,H,'I', sx,          sy, scale);
        drawGlyph(img,W,H,'M', sx+GW+GAP,   sy, scale);
        drawGlyph(img,W,H,'I', sx+GW*2+GAP*2, sy, scale);
    } else if (size >= 24) {
        // 32×32: scale=1, gap=1
        const scale=1, GAP=1;
        const GW=5, GH=9, tW=GW*3+GAP*2;
        const sx=Math.floor((W-tW)/2), sy=Math.floor((H-GH)/2);
        drawGlyph(img,W,H,'I', sx,          sy, scale);
        drawGlyph(img,W,H,'M', sx+GW+GAP,   sy, scale);
        drawGlyph(img,W,H,'I', sx+GW*2+GAP*2, sy, scale);
    } else {
        // 16×16: 'I' 한 글자만
        drawGlyph(img,W,H,'I', Math.floor((W-5)/2), Math.floor((H-9)/2), 1);
    }

    return encodePNG(W, H, img);
}

// ── ICO 파일 생성 (PNG 방식 — Vista 이상 지원) ──────────────
function createICO(sizes) {
    const pngs = sizes.map(s => createIconPNG(s));
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(sizes.length, 4);

    let offset = 6 + sizes.length * 16;
    const entries = pngs.map((png, i) => {
        const entry = Buffer.alloc(16);
        const s = sizes[i];
        entry[0] = s >= 256 ? 0 : s;
        entry[1] = s >= 256 ? 0 : s;
        entry[2] = 0; entry[3] = 0;
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(png.length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += png.length;
        return entry;
    });

    return Buffer.concat([header, ...entries, ...pngs]);
}

// ── 저장 ──────────────────────────────────────────────────
const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

const sizes = [16, 32, 48, 256];
const icoData = createICO(sizes);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoData);
console.log('icon.ico 생성 완료 (16/32/48/256px)');

const png256 = createIconPNG(256);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), png256);
console.log('icon.png 생성 완료 (256px)');
