document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('video-modal');
    const modalVideo = document.getElementById('modal-video');
    const closeButton = document.querySelector('.close-button');
    const videos = document.querySelectorAll('.tutorial-video');
    const startButton = document.getElementById('start-using');

    // 设置视频播放间隔
    videos.forEach(video => {
        // 当视频播放结束时
        video.addEventListener('ended', function() {
            // 暂停视频
            this.pause();
            // 2秒后重新开始播放
            setTimeout(() => {
                this.currentTime = 0; // 重置到开始位置
                this.play();
            }, 1000);
        });

        // 点击视频打开模态框
        video.addEventListener('click', () => {
            const videoSrc = video.querySelector('source').src;
            modalVideo.querySelector('source').src = videoSrc;
            modalVideo.load(); // 重新加载视频
            modalVideo.currentTime = 0; // 从头开始播放
            modal.style.display = 'block';
            setTimeout(() => modal.classList.add('show'), 10);
            modalVideo.play();
        });
    });

    // 关闭模态框
    const closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            modalVideo.pause();
        }, 300);
    };

    closeButton.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
            closeModal();
        }
    });

    // 开始使用按钮点击事件
    startButton.addEventListener('click', () => {
        window.close();
    });

    LocalStorageMgr.set('intro-completed', true);
}); 