import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

// Paths and transform keyframes extracted from the supplied Trash Can.json.
const lidPosition = [[0.2336,298.741,277.677],[0.4004,298.741,299.677],[0.5672,286.182,221.947],[0.8342,252.741,176.677],[1.0677,298.741,277.677],[1.2346,298.741,232.677],[1.368,298.741,277.677],[1.4681,298.741,252.677],[1.5682,298.741,277.677],[1.6683,298.741,266.677],[1.7684,298.741,267.677],[1.8018,298.741,277.677]];
const lidRotation = [[0.2336,0],[0.4004,0],[0.8342,-40],[1.0764,0],[1.2346,15],[1.368,0],[1.4681,-10],[1.5697,0],[1.6683,6],[1.7684,2],[1.8018,0]];
const bodyScale = [[0.2336,846.762,846.762],[0.4004,920,776.762],[0.5756,846.762,892.762],[0.7007,846.762,846.762],[0.8342,863,850],[0.9676,846.762,846.762]];
const trashDuration = 1.969;

export function DiscussionVoiceTrash({ deleting, onComplete }: { deleting: boolean; onComplete: () => void }) {
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const lid = useRef<SVGGElement>(null);
  const body = useRef<SVGGElement>(null);
  useEffect(() => {
    if (!deleting) return;
    if (!lid.current || !body.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      complete.current();
      return;
    }
    const animation = gsap.timeline();
    for (let i = 1; i < lidPosition.length; i += 1) {
      const [end, x, y] = lidPosition[i];
      const [begin] = lidPosition[i - 1];
      animation.to(lid.current, { x: x - 298.741, y: y - 277.677, duration: end - begin, ease: 'power1.inOut' }, begin);
    }
    for (let i = 1; i < lidRotation.length; i += 1) {
      const [end, rotation] = lidRotation[i];
      const [begin] = lidRotation[i - 1];
      animation.to(lid.current, { rotation, svgOrigin: '298.741 277.677', duration: end - begin, ease: 'power1.inOut' }, begin);
    }
    for (let i = 1; i < bodyScale.length; i += 1) {
      const [end, x, y] = bodyScale[i];
      const [begin] = bodyScale[i - 1];
      animation.to(body.current, { scaleX: x / 846.762, scaleY: y / 846.762, svgOrigin: '299.997 572.338',
        duration: end - begin, ease: 'power1.inOut' }, begin);
    }
    animation.call(() => complete.current(), undefined, trashDuration);
    return () => { animation.kill(); };
  }, [deleting]);

  return <svg width="24" height="24" viewBox="-20 -20 640 640" overflow="visible" fill="currentColor" aria-hidden="true">
    <g ref={body}>
      <g transform="translate(299.997 572.338) scale(8.46762) translate(-16.931 -33.878)">
        <path transform="translate(23.808 15.506)" fillRule="evenodd" d="M0.874 -12.199C0.03 -12.259 -0.702 -11.624 -0.762 -10.78L-0.762 -10.779L-2.292 10.621C-2.354 11.463 -1.722 12.195 -0.88 12.257L-0.764 12.257C0.04 12.259 0.709 11.638 0.766 10.837L2.294 -10.563C2.353 -11.407 1.718 -12.139 0.874 -12.199Z" />
        <path transform="translate(16.931 15.527)" fillRule="evenodd" d="M0.001 -12.22C-0.844 -12.22 -1.529 -11.535 -1.529 -10.691L-1.529 10.709C-1.508 11.553 -0.805 12.22 0.04 12.198C0.853 12.178 1.508 11.523 1.529 10.709L1.529 -10.691C1.529 -11.535 0.845 -12.22 0.001 -12.22Z" />
        <path transform="translate(10.053 15.506)" fillRule="evenodd" d="M2.294 10.626L2.294 10.62L0.764 -10.78C0.704 -11.624 -0.028 -12.26 -0.872 -12.2C-1.716 -12.14 -2.352 -11.407 -2.292 -10.562L-0.764 10.837C-0.707 11.639 -0.038 12.26 0.766 12.257L0.876 12.257C1.718 12.198 2.353 11.469 2.294 10.627L2.294 10.626Z" />
        <path transform="translate(16.931 17.064)" fillRule="evenodd" d="M10.833 13.757L-10.837 13.757L-13.604 -16.814L13.613 -16.814L10.833 13.757ZM-16.682 -16.814L-13.757 15.425C-13.685 16.215 -13.02 16.819 -12.227 16.815L12.229 16.815C13.022 16.819 13.686 16.215 13.758 15.426L16.682 -16.814" />
      </g>
    </g>
    <g ref={lid}>
      <g transform="translate(298.741 277.677) scale(8.46762) translate(-20.033 -8.044)">
        <path transform="translate(20.182 4.846)" fillRule="evenodd" d="M-4.586 -0.01C-4.586 -0.854 -3.901 -1.539 -3.057 -1.539L3.057 -1.539C3.901 -1.539 4.586 -0.854 4.586 -0.01L4.586 1.518L-4.585 1.518L-4.585 -0.01L-4.586 -0.01ZM16.681 4.575L18.343 4.575C19.187 4.596 19.889 3.93 19.91 3.086C19.932 2.241 19.266 1.54 18.421 1.518C18.395 1.517 18.369 1.517 18.343 1.518L18.342 1.518L7.643 1.518L7.643 -0.01C7.643 -2.543 5.59 -4.596 3.057 -4.596L-3.057 -4.596C-5.59 -4.596 -7.643 -2.543 -7.643 -0.01L-7.643 1.518L-18.343 1.518C-19.188 1.496 -19.889 2.163 -19.911 3.008C-19.932 3.852 -19.266 4.553 -18.421 4.575C-18.395 4.576 -18.369 4.576 -18.343 4.575L-16.682 4.575L16.681 4.575Z" />
      </g>
    </g>
  </svg>;
}
