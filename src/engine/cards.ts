import type { HanafudaCard, Month, CardType } from './types'

function card(
  id: string,
  month: Month,
  type: CardType,
  name: string,
  monthName: string,
  flowerName: string,
  points: number,
  emoji: string,
  tanzakuVariant?: 'aka' | 'ao' | 'normal',
): HanafudaCard {
  const base: HanafudaCard = { id, month, type, name, monthName, flowerName, points, emoji }
  if (tanzakuVariant) {
    return { ...base, tanzakuVariant }
  }
  return base
}

export const HANAFUDA_CARDS: readonly HanafudaCard[] = [
  // 1月 - 松 (Pine)
  card('jan-hikari', 1, 'hikari', '松に鶴', '1月', '松', 20, '🏯'),
  card('jan-tanzaku', 1, 'tanzaku', '松に赤短', '1月', '松', 5, '🎋', 'aka'),
  card('jan-kasu-1', 1, 'kasu', '松のカス', '1月', '松', 1, '🌲'),
  card('jan-kasu-2', 1, 'kasu', '松のカス', '1月', '松', 1, '🌲'),

  // 2月 - 梅 (Plum)
  card('feb-tane', 2, 'tane', '梅にうぐいす', '2月', '梅', 10, '🐦'),
  card('feb-tanzaku', 2, 'tanzaku', '梅に赤短', '2月', '梅', 5, '🌺', 'aka'),
  card('feb-kasu-1', 2, 'kasu', '梅のカス', '2月', '梅', 1, '🌸'),
  card('feb-kasu-2', 2, 'kasu', '梅のカス', '2月', '梅', 1, '🌸'),

  // 3月 - 桜 (Cherry Blossom)
  card('mar-hikari', 3, 'hikari', '桜に幕', '3月', '桜', 20, '🌸'),
  card('mar-tanzaku', 3, 'tanzaku', '桜に赤短', '3月', '桜', 5, '🎀', 'aka'),
  card('mar-kasu-1', 3, 'kasu', '桜のカス', '3月', '桜', 1, '🌷'),
  card('mar-kasu-2', 3, 'kasu', '桜のカス', '3月', '桜', 1, '🌷'),

  // 4月 - 藤 (Wisteria)
  card('apr-tane', 4, 'tane', '藤にほととぎす', '4月', '藤', 10, '🐦'),
  card('apr-tanzaku', 4, 'tanzaku', '藤に短冊', '4月', '藤', 5, '📜', 'normal'),
  card('apr-kasu-1', 4, 'kasu', '藤のカス', '4月', '藤', 1, '💜'),
  card('apr-kasu-2', 4, 'kasu', '藤のカス', '4月', '藤', 1, '💜'),

  // 5月 - 菖蒲 (Iris)
  card('may-tane', 5, 'tane', '菖蒲に八橋', '5月', '菖蒲', 10, '🌉'),
  card('may-tanzaku', 5, 'tanzaku', '菖蒲に短冊', '5月', '菖蒲', 5, '📜', 'normal'),
  card('may-kasu-1', 5, 'kasu', '菖蒲のカス', '5月', '菖蒲', 1, '💐'),
  card('may-kasu-2', 5, 'kasu', '菖蒲のカス', '5月', '菖蒲', 1, '💐'),

  // 6月 - 牡丹 (Peony)
  card('jun-tane', 6, 'tane', '牡丹に蝶', '6月', '牡丹', 10, '🦋'),
  card('jun-tanzaku', 6, 'tanzaku', '牡丹に青短', '6月', '牡丹', 5, '📘', 'ao'),
  card('jun-kasu-1', 6, 'kasu', '牡丹のカス', '6月', '牡丹', 1, '🌺'),
  card('jun-kasu-2', 6, 'kasu', '牡丹のカス', '6月', '牡丹', 1, '🌺'),

  // 7月 - 萩 (Bush Clover)
  card('jul-tane', 7, 'tane', '萩にいのしし', '7月', '萩', 10, '🐗'),
  card('jul-tanzaku', 7, 'tanzaku', '萩に短冊', '7月', '萩', 5, '📜', 'normal'),
  card('jul-kasu-1', 7, 'kasu', '萩のカス', '7月', '萩', 1, '🌿'),
  card('jul-kasu-2', 7, 'kasu', '萩のカス', '7月', '萩', 1, '🌿'),

  // 8月 - すすき/芒 (Silver Grass)
  card('aug-hikari', 8, 'hikari', '芒に月', '8月', 'すすき', 20, '🌕'),
  card('aug-tane', 8, 'tane', '芒に雁', '8月', 'すすき', 10, '🦆'),
  card('aug-kasu-1', 8, 'kasu', '芒のカス', '8月', 'すすき', 1, '🌾'),
  card('aug-kasu-2', 8, 'kasu', '芒のカス', '8月', 'すすき', 1, '🌾'),

  // 9月 - 菊 (Chrysanthemum)
  card('sep-tane', 9, 'tane', '菊に盃', '9月', '菊', 10, '🍶'),
  card('sep-tanzaku', 9, 'tanzaku', '菊に青短', '9月', '菊', 5, '📘', 'ao'),
  card('sep-kasu-1', 9, 'kasu', '菊のカス', '9月', '菊', 1, '🌼'),
  card('sep-kasu-2', 9, 'kasu', '菊のカス', '9月', '菊', 1, '🌼'),

  // 10月 - 紅葉 (Maple)
  card('oct-tane', 10, 'tane', '紅葉に鹿', '10月', '紅葉', 10, '🦌'),
  card('oct-tanzaku', 10, 'tanzaku', '紅葉に青短', '10月', '紅葉', 5, '📘', 'ao'),
  card('oct-kasu-1', 10, 'kasu', '紅葉のカス', '10月', '紅葉', 1, '🍁'),
  card('oct-kasu-2', 10, 'kasu', '紅葉のカス', '10月', '紅葉', 1, '🍁'),

  // 11月 - 柳 (Willow)
  card('nov-hikari', 11, 'hikari', '柳に小野道風', '11月', '柳', 20, '☔'),
  card('nov-tane', 11, 'tane', '柳にツバメ', '11月', '柳', 10, '🐦'),
  card('nov-tanzaku', 11, 'tanzaku', '柳に短冊', '11月', '柳', 5, '📜', 'normal'),
  card('nov-kasu', 11, 'kasu', '柳のカス', '11月', '柳', 1, '🌿'),

  // 12月 - 桐 (Paulownia)
  card('dec-hikari', 12, 'hikari', '桐に鳳凰', '12月', '桐', 20, '🦚'),
  card('dec-kasu-1', 12, 'kasu', '桐のカス', '12月', '桐', 1, '🍂'),
  card('dec-kasu-2', 12, 'kasu', '桐のカス', '12月', '桐', 1, '🍂'),
  card('dec-kasu-3', 12, 'kasu', '桐のカス', '12月', '桐', 1, '🍂'),
] as const

export function getCardById(id: string): HanafudaCard | undefined {
  return HANAFUDA_CARDS.find((c) => c.id === id)
}

export function getCardsByMonth(month: Month): readonly HanafudaCard[] {
  return HANAFUDA_CARDS.filter((c) => c.month === month)
}

export function getCardsByType(type: CardType): readonly HanafudaCard[] {
  return HANAFUDA_CARDS.filter((c) => c.type === type)
}
