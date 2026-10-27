"""
Gera fotos sintéticas de tickets de ponto em condições difíceis, com o gabarito
(tests/benchmark/gabarito.json). Uso: python3 scripts/gerar-benchmark.py
Simula: papel térmico desbotado, falhas de impressão, inclinação, perspectiva,
papel curvado, sombra/iluminação desigual, desfoque, ruído e compressão JPEG.
"""
import json, math, random, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'benchmark')
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
MONO_B = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
COND = '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf'

def cnpj_dv(base12):
    vals = [ord(c) - 48 for c in base12]
    def dv(v):
        w, s = 2, 0
        for x in reversed(v):
            s += x * w; w = 2 if w == 9 else w + 1
        r = s % 11
        return 0 if r < 2 else 11 - r
    d1 = dv(vals); d2 = dv(vals + [d1])
    c = base12 + str(d1) + str(d2)
    return f'{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}'

CNPJ_A = cnpj_dv('457231740001')
CNPJ_B = cnpj_dv('114447770001')
CNPJ_C = '12.ABC.345/01DE-35'

TICKETS = {
  'henry': dict(lines=[
      '*HENRY PRISMA SF R02', 'EMPRESA: METALURGICA SAO JOSE LTDA', f'CNPJ: {CNPJ_A}',
      'END: RUA DOS OPERARIOS, 1500 - CAMPINAS', 'REP: 00004000660012345',
      'NOME: CARLOS ALBERTO DE SOUZA', 'PIS: 120.4567.890-5', 'NSR: 000045821',
      'DATA: 03/09/2026 HORA: 17:58'],
    truth=dict(date='2026-09-03', time='17:58', cnpj=CNPJ_A, ticketNumber='45821',
               employeeName='CARLOS ALBERTO DE SOUZA', company='METALURGICA SAO JOSE LTDA')),
  'controlid': dict(lines=[
      '*COMPROVANTE DE REGISTRO DE', '*PONTO DO TRABALHADOR', 'Empregador: Hospital Santa Clara',
      f'CNPJ {CNPJ_B}', 'Local: Av. Paulista, 1000', 'REP: 00014003750008765',
      'Nome: Juliana Ribeiro Lima', 'CPF: 529.982.247-25', 'NSR: 000000317',
      'Data/Hora: 14/08/2026 06:59'],
    truth=dict(date='2026-08-14', time='06:59', cnpj=CNPJ_B, ticketNumber='317',
               employeeName='Juliana Ribeiro Lima', company='Hospital Santa Clara')),
  'convencional': dict(lines=[
      '*SUPERMERCADO BOA COMPRA', 'Funcionario: Ana Paula Souza', 'Matricula: 4521',
      '*SAIDA PARA ALMOCO', '23/10/2026      12:00'],
    truth=dict(date='2026-10-23', time='12:00', markType='inicioIntervalo',
               employeeName='Ana Paula Souza', company='SUPERMERCADO BOA COMPRA')),
  'repp': dict(lines=[
      '*COMPROVANTE DE REGISTRO', '*DE PONTO DO TRABALHADOR', 'Empregador:',
      'TRANSPORTES RAPIDO SUL LTDA', f'CNPJ: {CNPJ_C}', 'Nome: PEDRO HENRIQUE COSTA',
      'CPF: 111.444.777-35', 'NSR: 000981233', 'Data: 01/10/2026  Hora: 22:04:31',
      'Codigo hash: 9F2A61C0B7E4'],
    truth=dict(date='2026-10-01', time='22:04', cnpj=CNPJ_C, ticketNumber='981233',
               employeeName='PEDRO HENRIQUE COSTA', company='TRANSPORTES RAPIDO SUL LTDA')),
  'nsrlinha': dict(lines=[
      'EMPREGADOR: COMERCIAL ALFA S/A', f'CNPJ {CNPJ_A.replace(".", "").replace("/", "").replace("-", "")}',
      'N REP 0000100002000123', 'EMPREGADO: MARIA OLIVEIRA', 'PIS 12045678905',
      'NSR 000000987 22/10/26 12:03'],
    truth=dict(date='2026-10-22', time='12:03', cnpj=CNPJ_A, ticketNumber='987',
               employeeName='MARIA OLIVEIRA', company='COMERCIAL ALFA S/A')),
}

def render(lines, font_size, faded, gaps, rnd):
    font = ImageFont.truetype(rnd.choice([MONO, COND]), font_size)
    bold = ImageFont.truetype(MONO_B, font_size)
    width = int(font_size * 0.62 * 36) + 60
    lh = int(font_size * 1.45)
    h = 60 + lh * len(lines) + 50
    paper = rnd.randint(232, 250)
    img = Image.new('L', (width, h), paper)
    d = ImageDraw.Draw(img)
    ink = 25 if not faded else rnd.randint(95, 135)
    y = 40
    for t in lines:
        b = t.startswith('*'); t = t.lstrip('*')
        f = bold if b else font
        w = d.textlength(t, font=f)
        d.text(((width - w) / 2 if b else 28, y), t, fill=ink, font=f)
        y += lh
    if gaps:  # falhas da cabeça térmica: faixas verticais claras
        for _ in range(rnd.randint(2, 4)):
            x = rnd.randint(0, width - 4)
            d.rectangle([x, 0, x + rnd.randint(1, 3), h], fill=paper)
    for x in range(0, width, 18):
        d.polygon([(x, h), (x + 9, h - 9), (x + 18, h)], fill=120)
    return img

def curl(img, amp):
    if amp == 0: return img
    w, h = img.size
    out = Image.new('L', (w, h + 2 * amp), 0)
    src = img.load(); dst = out.load()
    for x in range(w):
        off = int(amp * math.sin(math.pi * x / w))
        for y in range(h):
            dst[x, y + amp - off] = src[x, y]
    return out

def perspective_coeffs(src, dst):
    import numpy as np
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return list(np.linalg.solve(np.array(A, float), np.array(B, float)))

def photo(ticket, rnd, angle, persp, shadow, blur, scale, noise, quality, curl_amp):
    rgba = ticket.convert('L')
    rgba = curl(rgba, curl_amp)
    t = rgba.convert('RGBA')
    # máscara para recortar só o papel
    mask = Image.new('L', rgba.size, 255)
    mask = curl(Image.new('L', ticket.size, 255), curl_amp)
    t.putalpha(mask)
    t = t.rotate(angle, expand=True, resample=Image.BICUBIC)
    W, H = int(t.width * 1.6), int(t.height * 1.35)
    bg_color = rnd.choice([(92, 70, 52), (60, 60, 66), (150, 140, 120), (35, 45, 60)])
    bg = Image.new('RGB', (W, H), bg_color)
    px = bg.load()
    for _ in range(W * H // 40):  # textura da mesa
        x, y = rnd.randrange(W), rnd.randrange(H)
        c = rnd.randint(-18, 18)
        px[x, y] = tuple(max(0, min(255, v + c)) for v in bg_color)
    bg = bg.filter(ImageFilter.GaussianBlur(1.2))
    bg.paste(t, ((W - t.width) // 2, (H - t.height) // 2), t)
    img = bg
    if persp:
        w, h = img.size; k = persp
        dst = [(0, 0), (w, 0), (w, h), (0, h)]
        src = [(k * w * 0.6, k * h * 0.3), (w - k * w * 0.2, 0), (w, h - k * h * 0.4), (0, h)]
        img = img.transform((w, h), Image.PERSPECTIVE, perspective_coeffs(src, dst), Image.BICUBIC, fillcolor=bg_color)
    if shadow:
        w, h = img.size
        grad = Image.new('L', (w, h))
        gp = grad.load()
        for x in range(w):
            for y in range(0, h, 1):
                pass
        g = Image.linear_gradient('L').resize((w, h)).rotate(rnd.choice([0, 90, 180, 270]), expand=False).resize((w, h))
        g = g.point(lambda v: int(255 - shadow * (v)))
        img = Image.composite(img, Image.new('RGB', (w, h), (0, 0, 0)), g)
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    if blur: img = img.filter(ImageFilter.GaussianBlur(blur))
    if noise:
        p = img.load()
        for _ in range(img.width * img.height // 6):
            x, y = rnd.randrange(img.width), rnd.randrange(img.height)
            r, g, b = p[x, y]; n = rnd.randint(-noise, noise)
            p[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img

CONDITIONS = {
  'boa':      dict(angle=2,  persp=0.0,  shadow=0.0, blur=0.6, scale=1.0,  noise=6,  quality=90, faded=False, gaps=False, curl=0,  font=34),
  'inclinada':dict(angle=9,  persp=0.08, shadow=0.35, blur=0.8, scale=0.9, noise=8,  quality=85, faded=False, gaps=False, curl=10, font=32),
  'desbotada':dict(angle=-4, persp=0.05, shadow=0.5, blur=1.3, scale=0.75, noise=10, quality=75, faded=True,  gaps=True,  curl=16, font=30),
}

def main():
    rnd = random.Random(42)
    os.makedirs(OUT, exist_ok=True)
    truth = {}
    for name, spec in TICKETS.items():
        for cond, c in CONDITIONS.items():
            t = render(spec['lines'], c['font'], c['faded'], c['gaps'], rnd)
            img = photo(t, rnd, c['angle'], c['persp'], c['shadow'], c['blur'], c['scale'], c['noise'], c['quality'], c['curl'])
            fn = f'{name}-{cond}.jpg'
            img.save(os.path.join(OUT, fn), quality=c['quality'])
            truth[fn] = spec['truth']
    with open(os.path.join(OUT, 'gabarito.json'), 'w') as f:
        json.dump(truth, f, ensure_ascii=False, indent=2)
    print(len(truth), 'imagens')

main()
