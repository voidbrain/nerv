# F-098-T04: live check with a real crash

Owner steps for [F-098](../BACKLOG.md#f-098) (step F-098-T04). Run every command in a Terminal on the owner's Mac (NERV-01). The run of 2026-11-25 found the fleet empty (0 drones in every snapshot since 2026-11-19), so the drone is registered first. Replace the motor model with the one on the drone.

## 1. The fleet holds the drone

```bash
nerv fleet drones
```

Expected: `Smoke` is listed. If it is not, register it with the frame and the motors, in one message (the frame's version goes with the frame's model, after the word `frame`):

```bash
nerv chat "aggiungi il drone Smoke, frame AOS 5 v5.1, motori <modello motore>"
nerv fleet parts Smoke
```

Expected: a reply that Smoke was added; `fleet parts Smoke` lists the frame and four motors. A reply that asks which part category "modello" or "v. 5.1" is is B-137: note it in that record and use the message above, with `frame` before the model.

## 2. Spare motors

```bash
nerv chat "ho 3 motori <modello motore> nuovi"
nerv fleet spares motor
```

Expected: 3 new spare motors of that model.

## 3. The crash and the question

```bash
nerv chat "ho crashato Smoke, motore sinistro inferiore rotto"
nerv chat "quanti motori di scorta mi restano?"
```

Expected: the crash is recorded on Smoke's rear-left motor, and the answer gives the spare motors left. Note both replies in F-098; an "(invalid reply)" line before the answer is B-136.
