/**
 * Подача трека в симуляцию: запрашивает такты у ChartSource строго по порядку и
 * заранее, превращает элементы в сущности и держит их в очереди до spawnTick.
 * В состояние попадают только уже появившиеся объекты.
 */
import { GAME } from './config';
import { isObstacleSpec, makeCrystal, makeObstacle } from './entities';
import { TICKS_PER_BAR } from './timing';
import type { ChartItem, ChartSource, Crystal, Obstacle } from './types';

/** За сколько тиков до начала такта он запрашивается (SPEC §4, шаг 3). */
export const REQUEST_LEAD_TICKS = GAME.approach.base + TICKS_PER_BAR;

const NO_ITEMS: ChartSource = { bar: () => [] };

interface Queued {
  spawnTick: number;
}

function byArrival(a: ChartItem, b: ChartItem): number {
  return a.arriveTick - b.arriveTick;
}

/** Очередь по spawnTick: читается с головы, чтобы не сдвигать массив на каждом тике. */
class SpawnQueue<T extends Queued> {
  private readonly items: T[] = [];
  private head = 0;

  clear(): void {
    this.items.length = 0;
    this.head = 0;
  }

  /** Убрать уже выданные элементы (раз в такт — дешевле, чем shift на каждый объект). */
  compact(): void {
    if (this.head === 0) return;
    this.items.copyWithin(0, this.head);
    this.items.length -= this.head;
    this.head = 0;
  }

  /** Вставка с сохранением порядка: обычно в конец, но трек не обязан отдавать такт отсортированным. */
  insert(item: T): void {
    const items = this.items;
    let i = items.length;
    items.push(item);
    while (i > this.head && items[i - 1].spawnTick > item.spawnTick) {
      items[i] = items[i - 1];
      i -= 1;
    }
    items[i] = item;
  }

  /** Перенести в out всё, что уже появилось к тику tick; сверх limit объекты отбрасываются. */
  release(tick: number, out: T[], limit: number): void {
    const items = this.items;
    while (this.head < items.length && items[this.head].spawnTick <= tick) {
      const item = items[this.head];
      this.head += 1;
      if (out.length < limit) out.push(item);
    }
  }
}

export class ChartFeed {
  private chart: ChartSource = NO_ITEMS;
  private nextBar = 0;
  private nextId = 1;
  private nextNote = 0;
  /** Фоновая сцена: одно время подлёта для всех объектов (0 — обычный забег). */
  private fixedApproach = 0;
  /** Фоновая сцена: препятствия не прилетают раньше этого тика. */
  private firstObstacleTick = 0;
  private readonly obstacles = new SpawnQueue<Obstacle>();
  private readonly crystals = new SpawnQueue<Crystal>();
  /** Копия такта для сортировки: массив, который вернул трек, не трогаем. */
  private readonly scratch: ChartItem[] = [];

  /**
   * Новый трек. fixedApproach > 0 включает режим фоновой сцены: все объекты
   * летят с этим временем подлёта, а препятствия до firstObstacleTick пропускаются.
   */
  reset(chart: ChartSource, fixedApproach = 0, firstObstacleTick = 0): void {
    this.chart = chart;
    this.nextBar = 0;
    this.nextId = 1;
    this.nextNote = 0;
    this.fixedApproach = fixedApproach;
    this.firstObstacleTick = firstObstacleTick;
    this.obstacles.clear();
    this.crystals.clear();
    this.scratch.length = 0;
  }

  /** Запросить все такты, которым пора: каждый один раз, по порядку. */
  request(tick: number): void {
    while (this.nextBar * TICKS_PER_BAR - REQUEST_LEAD_TICKS <= tick) {
      const bar = this.nextBar;
      this.nextBar += 1;
      this.load(this.chart.bar(bar), tick);
    }
  }

  /** Выпустить на дорогу объекты, у которых наступил spawnTick. */
  spawn(tick: number, obstacles: Obstacle[], crystals: Crystal[]): void {
    this.obstacles.release(tick, obstacles, GAME.limits.obstacles);
    this.crystals.release(tick, crystals, GAME.limits.crystals);
  }

  private load(items: readonly ChartItem[], tick: number): void {
    const sorted = this.scratch;
    sorted.length = 0;
    for (let i = 0; i < items.length; i++) {
      // Объект, который уже должен был прилететь (или с негодным временем), честно показать нельзя.
      if (items[i].arriveTick > tick && Number.isFinite(items[i].arriveTick)) sorted.push(items[i]);
    }
    // Порядок прилёта: по нему идут id и ноты мелодии, даже если трек отдал такт вперемешку.
    sorted.sort(byArrival);
    this.obstacles.compact();
    this.crystals.compact();

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      if (isObstacleSpec(item)) {
        if (item.arriveTick < this.firstObstacleTick) continue;
        const o = makeObstacle(item, this.nextId++);
        this.retime(o);
        this.obstacles.insert(o);
      } else {
        const c = makeCrystal(item, this.nextId++, this.nextNote++);
        this.retime(c);
        this.crystals.insert(c);
      }
    }
    sorted.length = 0;
  }

  private retime(entity: Obstacle | Crystal): void {
    if (this.fixedApproach <= 0) return;
    entity.approachTicks = this.fixedApproach;
    entity.spawnTick = entity.arriveTick - this.fixedApproach;
  }
}
