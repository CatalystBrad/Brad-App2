import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Directions: 0=N 1=E 2=S 3=W
const N = 0;
const E = 1;
const S = 2;
const W = 3;
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

type PipeType = 'straight' | 'elbow' | 'tee';
const BASE: Record<PipeType, number[]> = {
  straight: [N, S],
  elbow: [N, E],
  tee: [N, E, S],
};

const SIZE = 5;
const BEST_KEY = '@catalyst_drain_best';

const {width} = Dimensions.get('window');
const BOARD_PADDING = 16;
const BOARD_INNER = 6;
const GAP = 6;
const BOARD_WIDTH = width - BOARD_PADDING * 2;
const CELL_SIZE = (BOARD_WIDTH - BOARD_INNER * 2 - GAP * (SIZE - 1)) / SIZE;

interface Cell {
  type: PipeType;
  rot: number;
  fixed: boolean;
  r: number;
  c: number;
  solvedRot?: number;
}

const idx = (r: number, c: number) => r * SIZE + c;

const shuffle = <T,>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const dirFromTo = (r: number, c: number, r2: number, c2: number) => {
  if (r2 === r - 1) return N;
  if (r2 === r + 1) return S;
  if (c2 === c + 1) return E;
  return W;
};

const connsOf = (cell: Cell) => BASE[cell.type].map(d => (d + cell.rot) % 4);
const hasDir = (cell: Cell, d: number) => connsOf(cell).indexOf(d) !== -1;

// Carve a self-avoiding path from top-left to bottom-right.
const carvePath = (): number[][] => {
  const visited: boolean[][] = Array.from({length: SIZE}, () =>
    new Array(SIZE).fill(false),
  );
  const path: number[][] = [];
  const dfs = (r: number, c: number): boolean => {
    visited[r][c] = true;
    path.push([r, c]);
    if (r === SIZE - 1 && c === SIZE - 1) return true;
    for (const d of shuffle([N, E, S, W])) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && !visited[nr][nc]) {
        if (dfs(nr, nc)) return true;
      }
    }
    path.pop();
    return false;
  };
  dfs(0, 0);
  return path;
};

const typeRotFor = (dirs: number[]): {type: PipeType; rot: number} => {
  const target = [...dirs].sort().join(',');
  const types: PipeType[] = ['straight', 'elbow', 'tee'];
  for (const type of types) {
    for (let rot = 0; rot < 4; rot++) {
      const got = BASE[type]
        .map(d => (d + rot) % 4)
        .sort()
        .join(',');
      if (got === target) return {type, rot};
    }
  }
  return {type: 'elbow', rot: 0};
};

const filledSet = (cells: Cell[], startIdx: number): Set<number> => {
  const filled = new Set<number>([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const cur = queue.shift() as number;
    const cell = cells[cur];
    for (const d of connsOf(cell)) {
      const nr = cell.r + DR[d];
      const nc = cell.c + DC[d];
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const nIdx = idx(nr, nc);
      if (filled.has(nIdx)) continue;
      if (hasDir(cells[nIdx], (d + 2) % 4)) {
        filled.add(nIdx);
        queue.push(nIdx);
      }
    }
  }
  return filled;
};

const buildLevel = (): Cell[] => {
  const path = carvePath();
  const onPath = new Set(path.map(([r, c]) => idx(r, c)));

  const cells: Cell[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      cells.push({type: 'straight', rot: 0, fixed: false, r, c});
    }
  }

  const startIdx = idx(0, 0);
  const endIdx = idx(SIZE - 1, SIZE - 1);

  for (let p = 0; p < path.length; p++) {
    const [r0, c0] = path[p];
    const here = idx(r0, c0);
    const dirs: number[] = [];
    if (p > 0) {
      dirs.push(dirFromTo(r0, c0, path[p - 1][0], path[p - 1][1]));
    } else {
      dirs.push(W); // inlet stub
    }
    if (p < path.length - 1) {
      dirs.push(dirFromTo(r0, c0, path[p + 1][0], path[p + 1][1]));
    } else {
      dirs.push(E); // drain stub
    }
    const tr = typeRotFor(dirs);
    cells[here].type = tr.type;
    cells[here].rot = tr.rot;
    cells[here].solvedRot = tr.rot;
  }

  cells[startIdx].fixed = true;
  cells[endIdx].fixed = true;

  const decoys: PipeType[] = ['straight', 'elbow', 'elbow', 'tee'];
  for (let q = 0; q < cells.length; q++) {
    if (!onPath.has(q)) {
      cells[q].type = decoys[Math.floor(Math.random() * decoys.length)];
      cells[q].rot = Math.floor(Math.random() * 4);
    }
  }

  // Scramble non-fixed cells so it starts unsolved.
  for (const cell of cells) {
    if (!cell.fixed) {
      cell.rot = Math.floor(Math.random() * 4);
    }
  }
  if (filledSet(cells, startIdx).has(endIdx)) {
    const free = cells.find(x => !x.fixed);
    if (free) free.rot = (free.rot + 1) % 4;
  }

  return cells;
};

const START_IDX = idx(0, 0);
const END_IDX = idx(SIZE - 1, SIZE - 1);

const PipeTile = ({cell, filled}: {cell: Cell; filled: boolean}) => {
  const conns = connsOf(cell);
  const color = filled ? '#0A84FF' : '#9AA0A8';
  const thickness = CELL_SIZE * 0.34;
  const half = CELL_SIZE / 2;
  const offset = (CELL_SIZE - thickness) / 2;

  const bars: Record<number, object> = {
    [N]: {top: 0, left: offset, width: thickness, height: half},
    [S]: {top: half, left: offset, width: thickness, height: half},
    [W]: {left: 0, top: offset, height: thickness, width: half},
    [E]: {left: half, top: offset, height: thickness, width: half},
  };

  return (
    <View style={styles.tile}>
      {conns.map(d => (
        <View
          key={d}
          style={[styles.bar, {backgroundColor: color}, bars[d]]}
        />
      ))}
      <View
        style={[
          styles.hub,
          {
            backgroundColor: color,
            width: thickness,
            height: thickness,
            top: offset,
            left: offset,
          },
        ]}
      />
    </View>
  );
};

const CatalystGameScreen = () => {
  const [cells, setCells] = useState<Cell[]>(() => buildLevel());
  const [level, setLevel] = useState(1);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [best, setBest] = useState(0);

  const filled = useMemo(() => filledSet(cells, START_IDX), [cells]);
  const solved = filled.has(END_IDX);

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY).then(v => {
      if (v) setBest(parseInt(v, 10) || 0);
    });
  }, []);

  useEffect(() => {
    if (solved) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [solved, level]);

  // Persist the best (fewest) move count once a level is solved.
  useEffect(() => {
    if (!solved) return;
    setBest(prev => {
      if (prev === 0 || moves < prev) {
        AsyncStorage.setItem(BEST_KEY, String(moves));
        return moves;
      }
      return prev;
    });
  }, [solved, moves]);

  const handleTap = useCallback(
    (i: number) => {
      if (solved || cells[i].fixed) return;
      setCells(prev => {
        const next = prev.map(c => ({...c}));
        next[i].rot = (next[i].rot + 1) % 4;
        return next;
      });
      setMoves(m => m + 1);
    },
    [solved, cells],
  );

  const newLayout = useCallback(() => {
    setCells(buildLevel());
    setMoves(0);
    setSeconds(0);
  }, []);

  const nextLevel = useCallback(() => {
    setLevel(l => l + 1);
    newLayout();
  }, [newLayout]);

  return (
    <View style={styles.container}>
      <Text style={styles.subtitle}>
        Rotate the pipes — connect the inlet to the drain
      </Text>

      <View style={styles.scoreboard}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Level</Text>
          <Text style={styles.statValue}>{level}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Moves</Text>
          <Text style={styles.statValue}>{moves}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Time</Text>
          <Text style={styles.statValue}>{seconds}s</Text>
        </View>
      </View>

      <View style={styles.board}>
        {cells.map((cell, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={cell.fixed ? 1 : 0.7}
            onPress={() => handleTap(i)}
            style={[styles.cell, cell.fixed && styles.cellFixed]}>
            <PipeTile cell={cell} filled={filled.has(i)} />
            {i === START_IDX && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>IN</Text>
              </View>
            )}
            {i === END_IDX && (
              <View style={[styles.badge, styles.badgeOut]}>
                <Text style={styles.badgeText}>OUT</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={newLayout}>
          <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
            New Layout
          </Text>
        </TouchableOpacity>
        {solved && (
          <TouchableOpacity style={styles.button} onPress={nextLevel}>
            <Text style={styles.buttonText}>Next Level →</Text>
          </TouchableOpacity>
        )}
      </View>

      {solved && (
        <View style={styles.winBanner}>
          <Text style={styles.winText}>
            Flow restored! 💧 Solved in {moves} moves
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    padding: BOARD_PADDING,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 16,
  },
  scoreboard: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    marginHorizontal: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 11,
    color: '#8E8E93',
    marginBottom: 2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#D8D8DD',
    padding: BOARD_INNER,
    borderRadius: 16,
    width: BOARD_WIDTH,
    alignSelf: 'center',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    margin: GAP / 2,
    backgroundColor: '#F7F7FA',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cellFixed: {
    backgroundColor: '#E8F0FF',
  },
  tile: {
    flex: 1,
  },
  bar: {
    position: 'absolute',
    borderRadius: 4,
  },
  hub: {
    position: 'absolute',
    borderRadius: 6,
  },
  badge: {
    position: 'absolute',
    top: 2,
    left: 2,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 5,
  },
  badgeOut: {
    backgroundColor: '#34C759',
    left: undefined,
    right: 2,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  controls: {
    flexDirection: 'row',
    marginTop: 16,
  },
  button: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonSecondary: {
    backgroundColor: '#FFFFFF',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonTextSecondary: {
    color: '#007AFF',
  },
  winBanner: {
    marginTop: 16,
    backgroundColor: '#E6F8EC',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  winText: {
    color: '#1B7F3B',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CatalystGameScreen;
