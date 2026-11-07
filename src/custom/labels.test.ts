import { describe, expect, it } from 'vitest';
import { lengthLabel, levelNameFromArchive, ratingTone } from './labels';

describe('levelNameFromArchive', () => {
    it('reads the name out of TRCustoms’ download names', () => {
        expect(levelNameFromArchive('4332-CrusadersDuty-V4-Shadoofus.zip')).toBe('Crusaders Duty');
        expect(levelNameFromArchive('4075-OneNightAtTheLibrary-V2-MaskedGoon.zip')).toBe('One Night At The Library');
        expect(levelNameFromArchive('3826-ISore-Someone.zip')).toBe('I Sore');
        expect(levelNameFromArchive('3467-Mood-dj_full.zip')).toBe('Mood');
    });

    it('keeps other names, without their extension', () => {
        expect(levelNameFromArchive('My level.zip')).toBe('My level');
        expect(levelNameFromArchive('pack.tar.gz')).toBe('pack');
    });
});

describe('labels', () => {
    it('words lengths by their hours', () => {
        expect(lengthLabel('Short (<1 hour)')).toBe('Under 1 hour');
        expect(lengthLabel('Very long (6+ hours)')).toBe('6+ hours');
        expect(lengthLabel(null)).toBeNull();
    });

    it('colours rating classes by their place', () => {
        expect(ratingTone(5)).toBe('best');
        expect(ratingTone(2)).toBe('good');
        expect(ratingTone(0)).toBe('mixed');
        expect(ratingTone(-3)).toBe('bad');
    });
});
