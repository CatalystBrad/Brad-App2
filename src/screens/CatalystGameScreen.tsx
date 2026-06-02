import React, {useState, useRef, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HIGH_SCORE_KEY = '@catalyst_game_high_score';
const GRID_SIZE = 9; // 3 x 3
const ROUND_SECONDS = 30;

type CellType = 'empty' | 'target' | 'bomb';
type GameState = 'idle' | 'playing' | 'over';

const {width} = Dimensions.get('window');
const CELL_GAP = 12;
const BOARD_PADDING = 16;
const CELL_SIZE = (width - BOARD_PADDING * 2 - CELL_GAP * 2) / 3;

const CatalystGameScreen = () => {
  const [cells, setCells] = useState<CellType[]>(
    Array(GRID_SIZE).fill('empty'),
  );
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [gameState, setGameState] = useState<GameState>('idle');

  const spawnTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load the saved high score once on mount.
  useEffect(() => {
    AsyncStorage.getItem(HIGH_SCORE_KEY).then(value => {
      if (value) {
        setHighScore(parseInt(value, 10) || 0);
      }
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (spawnTimer.current) {
      clearInterval(spawnTimer.current);
      spawnTimer.current = null;
    }
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
  }, []);

  // Make sure timers never outlive the screen.
  useEffect(() => clearTimers, [clearTimers]);

  const endGame = useCallback(() => {
    clearTimers();
    setCells(Array(GRID_SIZE).fill('empty'));
    setGameState('over');
    setScore(current => {
      setHighScore(prevHigh => {
        if (current > prevHigh) {
          AsyncStorage.setItem(HIGH_SCORE_KEY, String(current));
          return current;
        }
        return prevHigh;
      });
      return current;
    });
  }, [clearTimers]);

  const spawn = useCallback(() => {
    setCells(() => {
      const next: CellType[] = Array(GRID_SIZE).fill('empty');
      const index = Math.floor(Math.random() * GRID_SIZE);
      // ~1 in 4 spawns is a bomb to keep players honest.
      next[index] = Math.random() < 0.25 ? 'bomb' : 'target';
      return next;
    });
  }, []);

  const startGame = useCallback(() => {
    clearTimers();
    setScore(0);
    setTimeLeft(ROUND_SECONDS);
    setCells(Array(GRID_SIZE).fill('empty'));
    setGameState('playing');

    spawn();
    spawnTimer.current = setInterval(spawn, 800);
    countdownTimer.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          endGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimers, spawn, endGame]);

  const handleCellPress = useCallback(
    (index: number) => {
      if (gameState !== 'playing') {
        return;
      }
      const cell = cells[index];
      if (cell === 'empty') {
        return;
      }

      setCells(prev => {
        const next = [...prev];
        next[index] = 'empty';
        return next;
      });

      if (cell === 'target') {
        setScore(prev => prev + 1);
      } else if (cell === 'bomb') {
        setScore(prev => Math.max(0, prev - 2));
      }
    },
    [gameState, cells],
  );

  const renderCell = (cell: CellType, index: number) => {
    let label = '';
    let cellStyle = styles.cellEmpty;
    if (cell === 'target') {
      label = '⚡';
      cellStyle = styles.cellTarget;
    } else if (cell === 'bomb') {
      label = '💣';
      cellStyle = styles.cellBomb;
    }

    return (
      <TouchableOpacity
        key={index}
        activeOpacity={0.7}
        style={[styles.cell, cellStyle]}
        onPress={() => handleCellPress(index)}>
        <Text style={styles.cellText}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.scoreboard}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Score</Text>
          <Text style={styles.statValue}>{score}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Time</Text>
          <Text style={styles.statValue}>{timeLeft}s</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Best</Text>
          <Text style={styles.statValue}>{highScore}</Text>
        </View>
      </View>

      <View style={styles.board}>
        {cells.map((cell, index) => renderCell(cell, index))}
      </View>

      {gameState === 'idle' && (
        <View style={styles.overlay}>
          <Text style={styles.title}>Catalyst Tap ⚡</Text>
          <Text style={styles.instructions}>
            Tap the ⚡ to score. Avoid the 💣 (it costs you 2 points). You have{' '}
            {ROUND_SECONDS} seconds — how high can you charge up?
          </Text>
          <TouchableOpacity style={styles.button} onPress={startGame}>
            <Text style={styles.buttonText}>Start Game</Text>
          </TouchableOpacity>
        </View>
      )}

      {gameState === 'over' && (
        <View style={styles.overlay}>
          <Text style={styles.title}>Time's Up!</Text>
          <Text style={styles.finalScore}>You scored {score}</Text>
          {score >= highScore && score > 0 && (
            <Text style={styles.newBest}>🏆 New best score!</Text>
          )}
          <TouchableOpacity style={styles.button} onPress={startGame}>
            <Text style={styles.buttonText}>Play Again</Text>
          </TouchableOpacity>
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
  scoreboard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: CELL_SIZE * 3 + CELL_GAP * 2,
    alignSelf: 'center',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 16,
    marginBottom: CELL_GAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellEmpty: {
    backgroundColor: '#E5E5EA',
  },
  cellTarget: {
    backgroundColor: '#FFD60A',
  },
  cellBomb: {
    backgroundColor: '#FF453A',
  },
  cellText: {
    fontSize: CELL_SIZE * 0.45,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(242, 242, 247, 0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 16,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    color: '#3A3A3C',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  finalScore: {
    fontSize: 22,
    color: '#3A3A3C',
    marginBottom: 12,
  },
  newBest: {
    fontSize: 18,
    color: '#34C759',
    fontWeight: '600',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default CatalystGameScreen;
