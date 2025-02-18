document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('video-modal');
    const modalVideo = document.getElementById('modal-video');
    const closeButton = document.querySelector('.close-button');
    const videos = document.querySelectorAll('.tutorial-video');
    const startButton = document.getElementById('start-using');
    const shortcutsSettingsButton = document.getElementById('goto-shortcuts-settings');

    // 轮播图相关元素
    const track = document.querySelector('.carousel-track');
    const steps = document.querySelectorAll('.step');
    const prevButton = document.querySelector('.carousel-button.prev');
    const nextButton = document.querySelector('.carousel-button.next');
    const indicators = document.querySelectorAll('.indicator');
    
    let currentIndex = 0;
    const totalSteps = steps.length;

    // 更新轮播图状态
    const updateCarousel = (index, direction = 'next') => {
        // 处理循环索引
        if (index < 0) {
            index = totalSteps - 1;
        } else if (index >= totalSteps) {
            index = 0;
        }

        // 更新步骤状态
        steps.forEach((step, i) => {
            step.classList.remove('active', 'prev', 'next');
            
            if (i === index) {
                step.classList.add('active');
            } else if (direction === 'next' ? i < index : i > index) {
                step.classList.add('prev');
            } else {
                step.classList.add('next');
            }

            // 暂停所有视频
            const video = step.querySelector('video');
            if (video) {
                video.pause();
                video.currentTime = 0;
            }
        });

        // 播放当前视频
        const currentVideo = steps[index].querySelector('video');
        if (currentVideo) {
            currentVideo.play().catch(error => console.log('视频自动播放失败:', error));
        }

        // 更新指示器状态
        indicators.forEach((indicator, i) => {
            indicator.classList.toggle('active', i === index);
        });

        // 返回处理后的索引
        return index;
    };

    // 切换到下一步
    const goToNext = () => {
        currentIndex = updateCarousel(currentIndex + 1, 'next');
    };

    // 切换到上一步
    const goToPrev = () => {
        currentIndex = updateCarousel(currentIndex - 1, 'prev');
    };

    // 绑定按钮事件
    prevButton.addEventListener('click', goToPrev);
    nextButton.addEventListener('click', goToNext);

    // 绑定指示器事件
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            const direction = index > currentIndex ? 'next' : 'prev';
            currentIndex = updateCarousel(index, direction);
        });
    });

    // 键盘导航
    document.addEventListener('keydown', (e) => {
        if (modal.style.display !== 'block') {  // 只在模态框关闭时响应
            if (e.key === 'ArrowLeft') {
                goToPrev();
            } else if (e.key === 'ArrowRight') {
                goToNext();
            }
        }
    });

    // 设置视频播放间隔
    videos.forEach((video, videoIndex) => {
        // 当视频播放结束时
        video.addEventListener('ended', function() {
            // 暂停视频
            this.pause();
            // 2秒后重新开始播放
            setTimeout(async () => {
                this.currentTime = 0; // 重置到开始位置
                try {
                    // 只有当前显示的视频才重新播放
                    if (videoIndex === currentIndex) {
                        await this.play();
                    }
                } catch (error) {
                    console.log('视频播放失败:', error);
                }
            }, 1000);
        });

        // 点击视频打开模态框
        video.addEventListener('click', async () => {
            // 获取当前显示的视频的source
            const currentStep = steps[currentIndex];
            const currentVideo = currentStep.querySelector('.tutorial-video');
            const videoSrc = currentVideo.querySelector('source').src;
            
            modalVideo.querySelector('source').src = videoSrc;
            modalVideo.load(); // 重新加载视频
            modalVideo.currentTime = 0; // 从头开始播放
            modal.style.display = 'block';
            setTimeout(() => modal.classList.add('show'), 10);
            
            try {
                await modalVideo.play();
            } catch (error) {
                console.log('模态框视频播放失败:', error);
            }
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

    // 添加快捷键设置按钮点击事件
    shortcutsSettingsButton.addEventListener('click', () => {
        chrome.tabs.create({
            url: 'chrome://extensions/shortcuts'
        });
    });

    // 初始化轮播图
    updateCarousel(0);
    LocalStorageMgr.set('intro-completed', true);
}); 