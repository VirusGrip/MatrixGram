import {useLayoutEffect, useRef, type TextareaHTMLAttributes} from 'react';

export function ComposerInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const element = ref.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const minimum = parseFloat(style.minHeight) || 36;
    const maximum = parseFloat(style.maxHeight) || 176;
    element.style.height = '0px';
    const height = element.scrollHeight;
    element.style.height = `${Math.max(minimum, Math.min(maximum, height))}px`;
    element.style.overflowY = height > maximum ? 'auto' : 'hidden';
  };
  useLayoutEffect(resize, [props.value]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {width = element.clientWidth; resize();}
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={ref}/>;
}
