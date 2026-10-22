#!/usr/bin/env python3
"""Recreate the original, royalty-free ambient demos shipped with the player.

Uses only the Python standard library. Each PCM WAV is mono, 22.05 kHz, 16-bit,
and 22 seconds long. These are original synthesized compositions, not samples.
"""

from array import array
from math import cos, exp, pi, sin
from pathlib import Path
import random
import sys
import wave


RATE = 22_050
DURATION = 22
DESTINATION = Path(__file__).resolve().parents[1] / "public" / "demo"


def frequency(midi: int) -> float:
    return 440 * 2 ** ((midi - 69) / 12)


def add_pad(samples: array, midi: int, start: float, length: float, level: float) -> None:
    frequency_hz = frequency(midi)
    first = int(start * RATE)
    last = min(len(samples), first + int(length * RATE))
    for index in range(first, last):
        t = (index - first) / RATE
        envelope = min(1, t / 1.6) * min(1, (length - t) / 2.8)
        phase = 2 * pi * frequency_hz * t
        tone = (
            sin(phase) * 0.68
            + sin(phase * 1.0017 + 0.4) * 0.18
            + sin(phase * 0.9984 + 0.8) * 0.14
            + sin(phase * 2) * 0.07
        )
        samples[index] += tone * envelope * level


def add_piano(samples: array, midi: int, start: float, level: float) -> None:
    frequency_hz = frequency(midi)
    first = int(start * RATE)
    last = min(len(samples), first + int(5.8 * RATE))
    for index in range(first, last):
        t = (index - first) / RATE
        phase = 2 * pi * frequency_hz * t
        attack = min(1, t / 0.018)
        envelope = attack * exp(-t * 0.95)
        tone = (
            sin(phase) * exp(-t * 0.12)
            + 0.24 * sin(phase * 2.001) * exp(-t * 0.6)
            + 0.075 * sin(phase * 3.004) * exp(-t * 1.1)
            + 0.026 * sin(phase * 4.009) * exp(-t * 1.8)
        )
        samples[index] += tone * envelope * level


def render(name: str, chords: list[list[int]], melody: list[int], seed: int) -> None:
    rng = random.Random(seed)
    dry = array("d", [0.0]) * (RATE * DURATION)
    for chord_index, chord in enumerate(chords):
        start = chord_index * 6
        for note_index, midi in enumerate(chord):
            add_pad(dry, midi, start + note_index * 0.05, 9.2, 0.045)
            add_piano(dry, midi + 12, start + 0.12 + note_index * 0.38, 0.07)
    for index, midi in enumerate(melody):
        add_piano(dry, midi, 1.5 + index * 1.75 + rng.uniform(-0.04, 0.04), 0.075)

    # A few low-volume diffuse reflections make the sound less dry without
    # relying on an external sample pack or an audio processing dependency.
    wet = array("d", dry)
    for delay, amount in [(0.211, 0.13), (0.353, 0.11), (0.557, 0.07), (0.811, 0.04)]:
        offset = int(delay * RATE)
        for index in range(offset, len(wet)):
            wet[index] += dry[index - offset] * amount
    peak = max(abs(sample) for sample in wet) or 1
    pcm = array("h")
    for index, sample in enumerate(wet):
        t = index / RATE
        # Smooth fades guarantee a quiet start and click-free ending.
        fade_in = 0.5 - 0.5 * cos(pi * min(1, t / 0.15))
        fade_out = 0.5 - 0.5 * cos(pi * min(1, (DURATION - t) / 2.1))
        pcm.append(round(sample / peak * 25_000 * fade_in * fade_out))
    if sys.byteorder != "little":
        pcm.byteswap()
    with wave.open(str(DESTINATION / f"{name}.wav"), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    print(f"{name}.wav: {DURATION}s, mono {RATE} Hz, peak <= 25000/32767")


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    render(
        "soft-focus",
        [[50, 57, 61, 66], [43, 54, 59, 62], [45, 52, 57, 61], [50, 57, 61, 66]],
        [78, 73, 76, 69, 74, 78, 76, 73, 69, 73, 74],
        11,
    )
    render(
        "blue-hour",
        [[45, 52, 59, 60], [41, 48, 55, 57], [48, 55, 59, 64], [43, 50, 57, 59]],
        [76, 71, 72, 67, 69, 72, 76, 74, 71, 67, 69],
        22,
    )
    render(
        "afterglow",
        [[41, 48, 57, 60], [43, 50, 57, 62], [48, 55, 59, 64], [41, 48, 55, 57]],
        [81, 79, 76, 72, 74, 79, 76, 74, 72, 69, 72],
        33,
    )
