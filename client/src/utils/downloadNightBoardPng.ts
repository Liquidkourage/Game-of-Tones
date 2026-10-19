import html2canvas from 'html2canvas';

/** Capture a mounted NightBoardPoster (1080×1350) and download PNG. */
export async function downloadNightBoardPngFromElement(
  node: HTMLElement,
  fileBase: string,
): Promise<void> {
  const canvas = await html2canvas(node, {
    width: 1080,
    height: 1350,
    scale: 1,
    backgroundColor: '#0a1210',
    useCORS: true,
    logging: false,
  });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${fileBase}.png`;
  a.click();
}
