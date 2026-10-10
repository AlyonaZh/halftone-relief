// Источники аудиореактивности: подписи и расшифровки частот — единственное место с этими текстами
// (окно реакции, подсказка пилюли у слайдера, строка на телефоне). docs/changes-v6.md §2, §4, §6.
import type { AudioSource } from '../defaults';

export const SOURCE_ORDER: AudioSource[] = ['low', 'mid', 'high', 'kick'];

/** Короткая подпись на кнопке и пилюле */
export const SOURCE_SHORT: Record<AudioSource, string> = {
  low: 'НЧ',
  mid: 'СЧ',
  high: 'ВЧ',
  kick: 'КИК',
};

/** Расшифровка источника */
export const SOURCE_DESC: Record<AudioSource, string> = {
  low: 'Низкие частоты: бас',
  mid: 'Средние частоты: голос, гитары',
  high: 'Высокие частоты: тарелки, хай-хэт',
  kick: 'Удары бочки',
};

/** Подсказка неактивной кнопки «Звук» */
export const SOUND_BUTTON_TIP = 'Нажмите, чтобы параметр двигался в такт музыке';

/** Подсказка активной пилюли у слайдера: «Низкие частоты: бас. Нажмите, чтобы настроить» */
export const pillTip = (s: AudioSource) => `${SOURCE_DESC[s]}. Нажмите, чтобы настроить`;

/** Подсказка кнопки источника в окне реакции; на выбранном — как отключить */
export const sourceButtonTip = (s: AudioSource, selected: boolean) =>
  selected ? `${SOURCE_DESC[s]}.\nНажмите ещё раз, чтобы отключить` : SOURCE_DESC[s];

/** Строка под кнопками источников на телефоне */
export const sourceLine = (s: AudioSource | null) =>
  s ? `${SOURCE_DESC[s]} · нажмите ещё раз, чтобы отключить` : 'Выберите, на что реагировать';
