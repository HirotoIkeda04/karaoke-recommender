import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "KyokuMoku — 音域ベースのカラオケ楽曲評価アプリ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadGoogleFont(family: string, weight: number, text: string) {
  const url =
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}` +
    `:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format/);
  if (!match) throw new Error(`failed to parse font css for ${family}`);
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

export default async function OGImage() {
  const iconBuffer = readFileSync(
    join(process.cwd(), "public", "icon-512.png"),
  );
  const iconDataUrl = `data:image/png;base64,${iconBuffer.toString("base64")}`;

  const title = "KyokuMoku";
  const subtitle = "音域ベースのカラオケ楽曲評価";

  const [bold, regular] = await Promise.all([
    loadGoogleFont("Noto Sans JP", 800, title),
    loadGoogleFont("Noto Sans JP", 500, subtitle),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 96px",
          background: "#0a0a0a",
          fontFamily: "Noto Sans JP",
        }}
      >
        <img
          src={iconDataUrl}
          width={340}
          height={340}
          style={{ borderRadius: 68 }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 64,
          }}
        >
          <div
            style={{
              fontSize: 112,
              fontWeight: 800,
              color: "#fafafa",
              letterSpacing: -3,
              lineHeight: 1,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 500,
              color: "#a1a1aa",
              lineHeight: 1.3,
              marginTop: 24,
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Noto Sans JP", data: bold, weight: 800, style: "normal" },
        { name: "Noto Sans JP", data: regular, weight: 500, style: "normal" },
      ],
    },
  );
}
