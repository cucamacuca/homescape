# Changelog

## 0.3.0

- **Kitchen islands** ([#6](https://github.com/muratozturkdev/homescape/issues/6)): counters, the stove, sink,
  dishwasher, oven and fridge can stand away from a wall; near a wall they still stick to it. A counter in an island has
  no wall cabinets.
- **Half walls** ([#6](https://github.com/muratozturkdev/homescape/issues/6)): every wall can be full height, half
  height (1.05 m) or open. Light passes over a half wall; people, pets and walk mode do not.
- **Sliding glass doors** ([#6](https://github.com/muratozturkdev/homescape/issues/6)), 1.2 to 3.6 m wide, that let
  daylight in like a window.
- **Double windows** ([#7](https://github.com/muratozturkdev/homescape/issues/7)): two sashes that open from the
  middle, each following its own sensor.
- **Fixed windows** that do not open ([#5](https://github.com/muratozturkdev/homescape/pull/5)).
- **Apartment mode** for flats: no roof, the street the right number of floors below, and the entrance opens onto the
  stairwell.
- **63 new items**: lights (night light, floodlight, light panels, neon sign), climate (portable AC, wood stove,
  extractor fan), media (turntable, floor speaker, streaming box, smart display, voice assistant), security, smart
  devices (hub, server rack, solar inverter, phone on a charger, UPS), kitchen (toaster, multicooker, freezer, wine
  fridge, ironing board), bathroom, furniture (bar stool, crib, pouf, coat rack, treadmill, exercise bike, piano, office
  chair), decor (wall clock, candles, Christmas tree, wall shelf, memo board...), pets, garden and garage. Beds come in
  three sizes and the sofa has a two-seat option.
- Plans are now saved in format 8. Older versions never write over them: they stop syncing until they are updated.

## 0.2.1

- The average temperature counts only indoor rooms: terraces, balconies and gardens no longer change it
  ([#3](https://github.com/muratozturkdev/homescape/issues/3)).
- LED strips have their own length, set in their card; the strip, its glow and its light follow it, and it never gets
  longer than its wall ([#4](https://github.com/muratozturkdev/homescape/issues/4)).
- Installing or updating the app builds exactly this version.

## 0.2.0

- Open-plan rooms: walls can be left out ([#2](https://github.com/muratozturkdev/homescape/issues/2)). In edit mode click
  a wall to select and delete it, or use the new Walls list in the room card, where a room can also lose all its walls.
  The rooms keep their own name, Home Assistant area and stats; lamps light the whole open space, and walk mode, people
  and pets pass through. Balcony and terrace railings can be removed the same way.
- Room names can be hidden in the 3D view (the tag button in the tool column, on phones in the three-dot menu).
- The sample home's names follow the language.
- The top bar fits small phones: under 640 px fullscreen moves into the three-dot menu.
- Plans are saved in a new format (6). Homescape 0.1.0 never writes over them: it stops syncing until it is updated.

## 0.1.0

- First release: Homescape in the Home Assistant sidebar through ingress.
