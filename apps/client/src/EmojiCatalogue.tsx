import Picker from 'emoji-picker-react';
import data from 'emoji-picker-react/data/emojis-ru';
import assets from './emoji-assets.json';
import extra from './emoji17.json';
const catalogue={...data,emojis:Object.fromEntries(Object.entries(data.emojis).map(([group,items])=>[group,[...items,...((extra as Record<string,typeof items>)[group]??[])]]))} as typeof data;
export default function EmojiCatalogue({select}:{select:(emoji:string)=>void}){
  return <Picker emojiData={catalogue} emojiStyle="twitter" lazyLoadEmojis getEmojiUrl={unified=>(assets as Record<string,string>)[unified]??(assets as Record<string,string>)[unified.replace(/-fe0f/g,'')]} colorScheme="auto" width="100%" height="100%" autoFocusSearch={false} previewConfig={{showPreview:false}} labels={{searchPlaceholder:'Поиск эмодзи',searchLabel:'Поиск эмодзи',searchClear:'Очистить поиск',searchResultsNone:'Эмодзи не найдены',categoryNavigation:'Категории эмодзи',skinToneNeutral:'Без оттенка',skinToneLight:'Светлый',skinToneMediumLight:'Умеренно светлый',skinToneMedium:'Средний',skinToneMediumDark:'Умеренно тёмный',skinToneDark:'Тёмный'}} onEmojiClick={value=>select(value.emoji)}/>;
}
