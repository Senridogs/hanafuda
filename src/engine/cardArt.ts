import type { HanafudaCard } from './types'

const FILE_BY_CARD_ID: Record<string, string> = {
  'jan-hikari': 'Hanafuda January Hikari Alt.svg',
  'jan-tanzaku': 'Hanafuda January Tanzaku Alt.svg',
  'jan-kasu-1': 'Hanafuda January Kasu 1 Alt.svg',
  'jan-kasu-2': 'Hanafuda January Kasu 2 Alt.svg',

  'feb-tane': 'Hanafuda February Tane Alt.svg',
  'feb-tanzaku': 'Hanafuda February Tanzaku Alt.svg',
  'feb-kasu-1': 'Hanafuda February Kasu 1 Alt.svg',
  'feb-kasu-2': 'Hanafuda February Kasu 2 Alt.svg',

  'mar-hikari': 'Hanafuda March Hikari Alt.svg',
  'mar-tanzaku': 'Hanafuda March Tanzaku Alt.svg',
  'mar-kasu-1': 'Hanafuda March Kasu 1 Alt.svg',
  'mar-kasu-2': 'Hanafuda March Kasu 2 Alt.svg',

  'apr-tane': 'Hanafuda April Tane Alt.svg',
  'apr-tanzaku': 'Hanafuda April Tanzaku Alt.svg',
  'apr-kasu-1': 'Hanafuda April Kasu 1 Alt.svg',
  'apr-kasu-2': 'Hanafuda April Kasu 2 Alt.svg',

  'may-tane': 'Hanafuda May Tane Alt.svg',
  'may-tanzaku': 'Hanafuda May Tanzaku Alt.svg',
  'may-kasu-1': 'Hanafuda May Kasu 1 Alt.svg',
  'may-kasu-2': 'Hanafuda May Kasu 2 Alt.svg',

  'jun-tane': 'Hanafuda June Tane Alt.svg',
  'jun-tanzaku': 'Hanafuda June Tanzaku Alt.svg',
  'jun-kasu-1': 'Hanafuda June Kasu 1 Alt.svg',
  'jun-kasu-2': 'Hanafuda June Kasu 2 Alt.svg',

  'jul-tane': 'Hanafuda July Tane Alt.svg',
  'jul-tanzaku': 'Hanafuda July Tanzaku Alt.svg',
  'jul-kasu-1': 'Hanafuda July Kasu 1 Alt.svg',
  'jul-kasu-2': 'Hanafuda July Kasu 2 Alt.svg',

  'aug-hikari': 'Hanafuda August Hikari Alt.svg',
  'aug-tane': 'Hanafuda August Tane Alt.svg',
  'aug-kasu-1': 'Hanafuda August Kasu 1 Alt.svg',
  'aug-kasu-2': 'Hanafuda August Kasu 2 Alt.svg',

  'sep-tane': 'Hanafuda September Tane Alt.svg',
  'sep-tanzaku': 'Hanafuda September Tanzaku Alt.svg',
  'sep-kasu-1': 'Hanafuda September Kasu 1 Alt.svg',
  'sep-kasu-2': 'Hanafuda September Kasu 2 Alt.svg',

  'oct-tane': 'Hanafuda October Tane Alt.svg',
  'oct-tanzaku': 'Hanafuda October Tanzaku Alt.svg',
  'oct-kasu-1': 'Hanafuda October Kasu 1 Alt.svg',
  'oct-kasu-2': 'Hanafuda October Kasu 2 Alt.svg',

  'nov-hikari': 'Hanafuda November Hikari Alt.svg',
  'nov-tane': 'Hanafuda November Tane Alt.svg',
  'nov-tanzaku': 'Hanafuda November Tanzaku Alt.svg',
  'nov-kasu': 'Hanafuda November Kasu Alt.svg',

  'dec-hikari': 'Hanafuda December Hikari Alt.svg',
  'dec-kasu-1': 'Hanafuda December Kasu 1 Alt.svg',
  'dec-kasu-2': 'Hanafuda December Kasu 2 Alt.svg',
  'dec-kasu-3': 'Hanafuda December Kasu 3 Alt.svg',
}

const WIKIMEDIA_SPECIAL_FILEPATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/'

export function getCardImageUrl(card: HanafudaCard): string {
  const fileName = FILE_BY_CARD_ID[card.id]
  if (!fileName) {
    return ''
  }
  return `${WIKIMEDIA_SPECIAL_FILEPATH}${encodeURIComponent(fileName)}`
}

export const CARD_ART_CREDIT_TEXT =
  '札画像: Wikimedia Commons (Louie Mantia / すけじょ), CC BY-SA 4.0'
export const CARD_ART_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
