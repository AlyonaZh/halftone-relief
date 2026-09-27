// Транспорт: общее время для видео, аудиофайла и «фото + аудио». Фрагмент [in, out] воспроизводится по кругу.

export class Transport {
  /** Ведущий элемент: видео, а для «фото + аудио» — аудиофайл */
  master: HTMLMediaElement | null = null;
  /** Ведомый: аудиофайл при загруженном видео */
  slave: HTMLMediaElement | null = null;
  inPoint = 0;
  outPoint = 0;
  /** Не зацикливать (во время записи) */
  noLoop = false;
  onEnd: (() => void) | null = null;
  /** Пользователь запустил воспроизведение (элемент может встать на паузу сам, дойдя до конца) */
  private active = false;

  get duration() {
    const d = this.master?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  get time() {
    return this.master?.currentTime ?? 0;
  }

  get playing() {
    return this.active;
  }

  async play() {
    const m = this.master;
    if (!m) return;
    if (m.currentTime < this.inPoint - 0.05 || m.currentTime >= this.outPoint - 0.03) {
      m.currentTime = this.inPoint;
    }
    this.syncSlave(true);
    this.active = true;
    const ps: Promise<void>[] = [m.play()];
    if (this.slave && this.slaveInRange()) ps.push(this.slave.play());
    await Promise.all(ps.map((p) => p.catch((e) => console.warn(e))));
  }

  pause() {
    this.active = false;
    this.master?.pause();
    this.slave?.pause();
  }

  seek(t: number) {
    const m = this.master;
    if (!m) return;
    m.currentTime = Math.max(0, Math.min(this.duration, t));
    this.syncSlave(true);
  }

  /** Дождаться окончания перемотки */
  seekAndWait(t: number): Promise<void> {
    const m = this.master;
    if (!m) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        m.removeEventListener('seeked', done);
        resolve();
      };
      m.addEventListener('seeked', done);
      this.seek(t);
      setTimeout(done, 1500);
    });
  }

  private slaveInRange() {
    const s = this.slave!;
    const d = Number.isFinite(s.duration) ? s.duration : 0;
    return this.time < d - 0.05;
  }

  private syncSlave(force = false) {
    const s = this.slave;
    const m = this.master;
    if (!s || !m) return;
    const d = Number.isFinite(s.duration) ? s.duration : 0;
    const t = m.currentTime;
    if (t >= d - 0.05) {
      if (!s.paused) s.pause();
      return;
    }
    if (force || Math.abs(s.currentTime - t) > 0.12) s.currentTime = t;
    if (!m.paused && s.paused) s.play().catch(() => {});
    if (m.paused && !s.paused) s.pause();
  }

  /** Вызывается каждый кадр: зацикливание фрагмента и синхронизация аудио */
  tick() {
    const m = this.master;
    if (!m) return;
    if (this.active && (m.currentTime >= this.outPoint - 0.01 || m.ended)) {
      if (this.noLoop) {
        this.pause();
        this.onEnd?.();
        return;
      }
      m.currentTime = this.inPoint;
      this.syncSlave(true);
      if (m.paused) m.play().catch(() => {});
    }
    this.syncSlave();
  }
}
