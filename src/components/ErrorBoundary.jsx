import { Component } from 'react';

/**
 * Penangkap error saat render.
 *
 * Tanpa ini, satu kesalahan kecil di salah satu halaman membuat seluruh
 * aplikasi kosong putih tanpa ada petunjuk apa pun. Di sini error ditampilkan
 * apa adanya supaya bisa diperbaiki, lengkap dengan tombol muat ulang.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { galat: null };
    this.cobaLagi = this.cobaLagi.bind(this);
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

  render() {
    const { galat } = this.state;
    const { children } = this.props;
    if (!galat) return children;

    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0 }}>Halaman ini gagal dibuka</h2>
        <p style={{ color: 'var(--text-secondary, #555)' }}>
          Ada kesalahan saat halaman dimuat. Aplikasi di bawah tidak terpengaruh.
        </p>
        <pre
          style={{
            background: 'var(--busy-bg, #fdecea)',
            color: 'var(--busy, #b3261e)',
            padding: 12,
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12
          }}
        >
          {String(galat && (galat.stack || galat.message || galat))}
        </pre>
        <button
          className="btn btn-primary"
          onClick={this.cobaLagi}
          style={{ marginTop: 12 }}
        >
          Coba lagi
        </button>
      </div>
    );
  }
}