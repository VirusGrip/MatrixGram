import {lazy,Suspense,useEffect,useRef,type RefObject} from 'react';
const Catalogue=lazy(()=>import('./EmojiCatalogue'));
export function EmojiChoices({select}:{select:(emoji:string)=>void}){return <Suspense fallback={<p role="status">Загружаем эмодзи…</p>}><Catalogue select={select}/></Suspense>;}
export function EmojiPanel({select,close,trigger}:{select:(emoji:string)=>void;close:()=>void;trigger:RefObject<HTMLButtonElement|null>}){
  const ref=useRef<HTMLDivElement>(null),closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{const outside=(e:Event)=>{if(!ref.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))closeRef.current();};window.addEventListener('pointerdown',outside,true);return()=>window.removeEventListener('pointerdown',outside,true);},[trigger]);
  return <div className="emoji-popover" ref={ref} role="dialog" aria-label="Выбор эмодзи"><EmojiChoices select={select}/></div>;
}
