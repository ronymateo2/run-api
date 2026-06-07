-- Seed: PROMs (cuestionarios de outcome validados)
--   - SPADI  → hombro (Shoulder Pain and Disability Index, 13 ítems, 0-10/ítem). Alto = peor.
--   - HAGOS  → ingle/pubalgia (Copenhagen Hip and Groin Outcome Score). Subescalas Dolor y
--     Deporte (subset representativo, 0-4/ítem Likert). Alto = mejor (invert=1).
--
-- `questions` es JSON [{id,text}]. El scorer del cliente normaliza con max_per_item/invert.
-- Idempotente (INSERT OR REPLACE), ids deterministas, timestamps en ms.
-- Aplicar:  npm run seed:proms:local   /   npm run seed:proms:remote

INSERT OR REPLACE INTO prom_instruments
  (id, name, zones, questions, max_per_item, invert, better_is_higher, every_days, sort_order, updated_at)
VALUES
(
  'spadi',
  'SPADI · Hombro',
  '["shoulder","hombro"]',
  '[{"id":"p1","text":"Dolor en su punto más intenso"},{"id":"p2","text":"Dolor al acostarse sobre el lado afectado"},{"id":"p3","text":"Dolor al alcanzar algo en un estante alto"},{"id":"p4","text":"Dolor al tocarse la nuca"},{"id":"p5","text":"Dolor al empujar con el brazo afectado"},{"id":"d1","text":"Lavarse el cabello"},{"id":"d2","text":"Lavarse la espalda"},{"id":"d3","text":"Ponerse una camiseta o jersey"},{"id":"d4","text":"Ponerse una camisa con botones"},{"id":"d5","text":"Ponerse los pantalones"},{"id":"d6","text":"Colocar un objeto en un estante alto"},{"id":"d7","text":"Cargar un objeto pesado (≈5 kg)"},{"id":"d8","text":"Sacar algo del bolsillo trasero"}]',
  10, 0, 0, 14, 1,
  strftime('%s','now') * 1000
),
(
  'hagos_pain',
  'HAGOS · Dolor (ingle)',
  '["groin","pubis","hip","ingle","cadera","pubalgia","adductor","aductor"]',
  '[{"id":"hp1","text":"¿Con qué frecuencia sientes dolor en la ingle o cadera?"},{"id":"hp2","text":"Dolor al estirar al máximo la cadera/ingle"},{"id":"hp3","text":"Dolor al girar o pivotar sobre la pierna"},{"id":"hp4","text":"Dolor por la noche en la cama"},{"id":"hp5","text":"Dolor al caminar sobre superficie dura"}]',
  4, 1, 1, 14, 2,
  strftime('%s','now') * 1000
),
(
  'hagos_sport',
  'HAGOS · Deporte (ingle)',
  '["groin","pubis","hip","ingle","cadera","pubalgia","adductor","aductor"]',
  '[{"id":"hs1","text":"Dificultad al correr"},{"id":"hs2","text":"Dificultad al girar o pivotar sobre la pierna"},{"id":"hs3","text":"Dificultad al acelerar"},{"id":"hs4","text":"Dificultad al frenar bruscamente"},{"id":"hs5","text":"Dificultad en movimientos explosivos (saltar, patear)"}]',
  4, 1, 1, 14, 3,
  strftime('%s','now') * 1000
);
