import { Component } from 'react';

/**
 * Penangkap error saat render.
 *
 * Tanpa ini, satu kesalahan kecil di salah satu halaman membuat seluruh
 * aplikasi kosong putih tanpa ada petunjuk apa pun.
 *
 * Dipasang dua lapis:
 *  - di main.jsx sebagai jaring terakhir seluruh aplikasi;
 *  - di App.jsx per halaman, sehingga halaman yang rusak hanya menggantikan
 *    area konten dan menu lain tetap bisa dipakai.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { galat: null };
    this.cobaLagi = this.cobaLagi.bind(this);
    this.kembali = this.kembali.bind(this);
  }

  static getDerivedStateFromError(galat) {
    return { galat };
  }

  componentDidCatch(galat, info) {
    console.error('Halaman gagal dirender:', galat, info);
  }

  cobaLagi() {
    this.setState({ galat: null });
  }

  kembali() {
    this.setState({ galat: null });
    this.props.onReset?.();
  }

  render() {
    const { galat } = this.state;
    const { children, title, onReset } = this.props;
    if (!galat) return children;

    return (
      <div className="page-error" role="alert">
        <h2>{title || 'Halaman ini gagal dibuka'}</h2>
        <p>
          Ada kesalahan saat halaman ini dimuat. Menu lain tetap bisa dipakai —
          coba lagi atau pindah ke halaman lain.
        </p>
        <div className="page-error-actions">
          <button className="btn btn-primary" onClick={this.cobaLagi}>
            Coba lagi
          </button>
          {onReset && (
            <button className="btn" onClick={this.kembali}>
              Kembali ke beranda
            </button>
          )}
        </div>
        <details className="page-error-detail">
          <summary>Detail teknis</summary>
          <pre>{String(galat?.stack || galat?.message || galat)}</pre>
        </details>
      </div>
    );
  }
}
