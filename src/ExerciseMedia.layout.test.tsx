// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExerciseMedia } from './ExerciseMedia';

const exercise = {
  id: 'bench-press',
  name: 'Bench press',
  reference_source: null,
  reference_key: null,
};

afterEach(cleanup);

describe('ExerciseMedia square detail layout', () => {
  it('uses the square image class only when the detail layout requests it', () => {
    const view = render(<ExerciseMedia exercise={exercise} sourceUrl="/media/bench.gif" variant="detail" />);
    const image = screen.getByRole('img');
    expect(image.classList.contains('exercise-media-image-detail--square')).toBe(false);

    view.rerender(<ExerciseMedia exercise={exercise} sourceUrl="/media/bench.gif" variant="detail" layout="square" />);
    expect(image.classList.contains('exercise-media-image-detail--square')).toBe(true);
    expect(image.getAttribute('src')).toBe('/media/bench.gif');
    expect(image.getAttribute('loading')).toBe('eager');
  });

  it('does not change thumbnail geometry when a square detail layout is requested', () => {
    const view = render(<ExerciseMedia exercise={exercise} sourceUrl="/media/bench.gif" variant="thumbnail" layout="square" />);
    const image = view.container.querySelector('img');
    expect(image?.classList.contains('exercise-media-image-thumbnail')).toBe(true);
    expect(image?.classList.contains('exercise-media-image-detail--square')).toBe(false);
  });
});
