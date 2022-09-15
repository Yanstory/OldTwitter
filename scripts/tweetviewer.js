class TweetViewer {
    constructor(user, settings, tweetData) {
        this.container = createModal(/*html*/`
            <div class="timeline" hidden></div>
            <div class="retweets" class="box" hidden></div>
            <div class="retweets_with_comments" hidden></div>
            <div class="likes" class="box" hidden></div>
            <div class="timeline-more center-text" hidden>Load more</div>
            <div class="retweets-more center-text" hidden>Load more</div>
            <div class="retweets_with_comments-more center-text" hidden>Load more</div>
            <div class="likes-more center-text" hidden>Load more</div>
        `, 'tweet-viewer', () => {
            this.close();
            history.pushState({}, null, previousLocation);
        });
        this.tweetData = tweetData;
        this.id = tweetData.id_str;
        let previousLocation = location.pathname;
        history.pushState({}, null, `https://twitter.com/${tweetData.user.screen_name}/status/${this.id}`);

        this.user = user;
        this.loadingNewTweets = false;
        this.lastTweetDate = 0;
        this.activeTweet;
        this.pageData = {};
        this.settings = settings;
        this.tweets = [];
        this.cursor = undefined;
        this.mediaToUpload = [];
        this.linkColors = {};
        this.likeCursor = undefined;
        this.retweetCursor = undefined;
        this.retweetCommentsCursor = undefined;
        this.seenReplies = [];
        this.mainTweetLikers = [];
        this.currentLocation = location.pathname;
        this.subpage = undefined;
        this.popstateHelper = undefined;

        let event = new CustomEvent('clearActiveTweet');
        document.dispatchEvent(event);

        this.init();
    }
    async savePageData(path) {
        if(!path) {
            path = location.pathname.split('?')[0].split('#')[0];
            if(path.endsWith('/')) path = path.slice(0, -1);
        }
        this.pageData[path] = {
            linkColors: this.linkColors,
            cursor: this.cursor,
            likeCursor: this.likeCursor,
            retweetCursor: this.retweetCursor,
            retweetCommentsCursor: this.retweetCommentsCursor,
            mainTweetLikers: this.mainTweetLikers,
            seenReplies: this.seenReplies,
            tweets: this.tweets,
            scrollY: this.container.scrollTop
        }
        console.log(`Saving page: ${path}`, this.pageData[path]);
    }
    async restorePageData() {
        let path = location.pathname.split('?')[0].split('#')[0];
        if(path.endsWith('/')) path = path.slice(0, -1);
        if(this.pageData[path]) {
            console.log(`Restoring page: ${path}`, this.pageData[path]);
            this.linkColors = this.pageData[path].linkColors;
            this.cursor = this.pageData[path].cursor;
            this.likeCursor = this.pageData[path].likeCursor;
            this.retweetCursor = this.pageData[path].retweetCursor;
            this.retweetCommentsCursor = this.pageData[path].retweetCommentsCursor;
            this.mainTweetLikers = this.pageData[path].mainTweetLikers;
            this.seenReplies = [];
            this.tweets = [];
            this.container.getElementsByClassName('timeline-more')[0].hidden = !this.cursor;
            let tl = document.getElementsByClassName('timeline')[0];
            tl.innerHTML = '';
            for(let i in this.pageData[path].tweets) {
                let t = this.pageData[path].tweets[i];
                if(t[0] === 'tweet') {
                    await this.appendTweet(t[1], tl, t[2]);
                } else if(t[0] === 'compose') {
                    await this.appendComposeComponent(tl, t[1]);
                } else if(t[0] === 'tombstone') {
                    await this.appendTombstone(tl, t[1]);
                }
            }
            let id = this.currentLocation.match(/status\/(\d{1,32})/)[1];
            if(id) {
                setTimeout(() => {
                    let tweet = this.container.getElementsByClassName(`tweet-id-${id}`)[0];
                    if(tweet) {
                        tweet.scrollIntoView({ block: 'center' });
                    }
                }, 100);
            }
            return true;
        } else {
            this.tweets = [];
            this.seenReplies = [];
        }
        return false;
    }
    updateSubpage() {
        let path = location.pathname.slice(1);
        if(path.endsWith('/')) path = path.slice(0, -1);

        let tlDiv = document.getElementsByClassName('timeline')[0];
        let rtDiv = document.getElementsByClassName('retweets')[0];
        let rtwDiv = document.getElementsByClassName('retweets_with_comments')[0];
        let likesDiv = document.getElementsByClassName('likes')[0];
        let tlMore = document.getElementsByClassName('timeline-more')[0];
        let rtMore = document.getElementsByClassName('retweets-more')[0];
        let rtwMore = document.getElementsByClassName('retweets_with_comments-more')[0];
        let likesMore = document.getElementsByClassName('likes-more')[0];
        tlDiv.hidden = true; rtDiv.hidden = true; rtwDiv.hidden = true; likesDiv.hidden = true;
        tlMore.hidden = true; rtMore.hidden = true; rtwMore.hidden = true; likesMore.hidden = true;

        if(path.split('/').length === 3) {
            this.subpage = 'tweet';
            tlDiv.hidden = false;
        } else {
            if(path.endsWith('/retweets')) {
                this.subpage = 'retweets';
                rtDiv.hidden = false;
            } else if(path.endsWith('/likes')) {
                this.subpage = 'likes';
                likesDiv.hidden = false;
            } else if(path.endsWith('/retweets/with_comments')) {
                this.subpage = 'retweets_with_comments';
                rtwDiv.hidden = false;
            }
        }
    }
    async updateReplies(id, c) {
        if(!c) document.getElementsByClassName('timeline')[0].innerHTML = '';
        let tl, tweetLikers;
        try {
            let [tlData, tweetLikersData] = await Promise.allSettled([API.getReplies(id, c), API.getTweetLikers(id)]);
            if(!tlData.value) {
                this.cursor = undefined;
                return console.error(tlData.reason);
            }
            tl = tlData.value;
            tweetLikers = tweetLikersData.value;
            this.loadingNewTweets = false;
        } catch(e) {
            this.loadingNewTweets = false;
            return this.cursor = undefined;
        }
    
        if(vars.linkColorsInTL) {
            let tlUsers = [];
            for(let i in tl.list) {
                let t = tl.list[i];
                if(t.type === 'tweet' || t.type === 'mainTweet') { if(!tlUsers.includes(t.data.user.screen_name)) tlUsers.push(t.data.user.screen_name); }
                else if(t.type === 'conversation') {
                    for(let j in t.data) {
                        tlUsers.push(t.data[j].user.screen_name);
                    }
                }
            }
            tlUsers = tlUsers.filter(i => !this.linkColors[i]);
            let linkData = await fetch(`https://dimden.dev/services/twitter_link_colors/get_multiple/${tlUsers.join(',')}`).then(res => res.json()).catch(console.error);
            if(linkData) for(let i in linkData) {
                this.linkColors[linkData[i].username] = linkData[i].color;
            }
        }
    
        this.cursor = tl.cursor;
        if(!this.cursor) {
            this.container.getElementsByClassName('timeline-more')[0].hidden = true;
        } else {
            this.container.getElementsByClassName('timeline-more')[0].hidden = false;
        }
        let mainTweet;
        let mainTweetIndex = tl.list.findIndex(t => t.type === 'mainTweet');
        let tlContainer = document.getElementsByClassName('timeline')[0];
        for(let i in tl.list) {
            let t = tl.list[i];
            if(t.type === 'mainTweet') {
                this.mainTweetLikers = tweetLikers.list;
                this.likeCursor = tweetLikers.cursor;
                if(i === 0) {
                    mainTweet = await this.appendTweet(t.data, tlContainer, {
                        mainTweet: true
                    });
                } else {
                    mainTweet = await this.appendTweet(t.data, tlContainer, {
                        noTop: true,
                        mainTweet: true
                    });
                }
                if(t.data.limited_actions !== "non_compliant") this.appendComposeComponent(tlContainer, t.data);
            }
            if(t.type === 'tweet') {
                await this.appendTweet(t.data, tlContainer, {
                    noTop: i !== 0 && i < mainTweetIndex,
                    threadContinuation: i < mainTweetIndex
                });
            } else if(t.type === 'conversation') {
                for(let i2 in t.data) {
                    let t2 = t.data[i2];
                    await this.appendTweet(t2, tlContainer, {
                        noTop: +i2 !== 0,
                        threadContinuation: +i2 !== t.data.length - 1,
                        threadButton: +i2 === t.data.length - 1,
                        threadId: t2.conversation_id_str
                    });
                }
            } else if(t.type === 'tombstone') {
                appendTombstone(tlContainer, t.data);
            }
        }
        if(mainTweet) mainTweet.scrollIntoView();
        return true;
    }
    async updateLikes(id, c) {
        let tweetLikers;
        if(!c && this.mainTweetLikers.length > 0) {
            tweetLikers = this.mainTweetLikers;
        } else {
            try {
                tweetLikers = await API.getTweetLikers(id, c);
                this.likeCursor = tweetLikers.cursor;
                tweetLikers = tweetLikers.list;
                if(!c) this.mainTweetLikers = tweetLikers;
            } catch(e) {
                console.error(e);
                return this.likeCursor = undefined;
            }
        }
        let likeDiv = document.getElementsByClassName('likes')[0];
    
        if(!c) {
            likeDiv.innerHTML = '';
            let tweet = await appendTweet(await API.getTweet(id), likeDiv, {
                mainTweet: true
            });
            tweet.style.borderBottom = '1px solid var(--border)';
            tweet.style.marginBottom = '10px';
            tweet.style.borderRadius = '5px';
            let h1 = document.createElement('h1');
            h1.innerText = `Liked by`;
            h1.className = 'cool-header';
            likeDiv.appendChild(h1);
        }
        if(!this.likeCursor || tweetLikers.length === 0) {
            this.container.getElementsByClassName('likes-more')[0].hidden = true;
        } else {
            this.container.getElementsByClassName('likes-more')[0].hidden = false;
        }
    
        for(let i in tweetLikers) {
            let u = tweetLikers[i];
            let likeElement = document.createElement('div');
            likeElement.classList.add('following-item');
            likeElement.innerHTML = `
            <div>
                <a href="https://twitter.com/${u.screen_name}" class="following-item-link">
                    <img src="${u.profile_image_url_https}" alt="${u.screen_name}" class="following-item-avatar tweet-avatar" width="48" height="48">
                    <div class="following-item-text">
                        <span class="tweet-header-name following-item-name">${escapeHTML(u.name)}</span><br>
                        <span class="tweet-header-handle">@${u.screen_name}</span>
                    </div>
                </a>
            </div>
            <div>
                <button class="following-item-btn nice-button ${u.following ? 'following' : 'follow'}">${u.following ? 'Following' : 'Follow'}</button>
            </div>`;
    
            let followButton = likeElement.querySelector('.following-item-btn');
            followButton.addEventListener('click', async () => {
                if (followButton.classList.contains('following')) {
                    await API.unfollowUser(u.screen_name);
                    followButton.classList.remove('following');
                    followButton.classList.add('follow');
                    followButton.innerText = 'Follow';
                } else {
                    await API.followUser(u.screen_name);
                    followButton.classList.remove('follow');
                    followButton.classList.add('following');
                    followButton.innerText = 'Following';
                }
            });
    
            likeDiv.appendChild(likeElement);
        }
    }
    async updateRetweets(id, c) {
        let tweetRetweeters;
        try {
            tweetRetweeters = await API.getTweetRetweeters(id, c);
            this.retweetCursor = tweetRetweeters.cursor;
            tweetRetweeters = tweetRetweeters.list;
        } catch(e) {
            console.error(e);
            return this.retweetCursor = undefined;
        }
        let retweetDiv = document.getElementsByClassName('retweets')[0];
    
        if(!c) {
            retweetDiv.innerHTML = '';
            let tweet = await this.appendTweet(await API.getTweet(id), retweetDiv, {
                mainTweet: true
            });
            tweet.style.borderBottom = '1px solid var(--border)';
            tweet.style.marginBottom = '10px';
            tweet.style.borderRadius = '5px';
            let h1 = document.createElement('h1');
            h1.innerHTML = `Retweeted by (<a href="https://twitter.com/aabehhh/status/${id}/retweets/with_comments">see quotes</a>)`;
            h1.className = 'cool-header';
            retweetDiv.appendChild(h1);
            h1.getElementsByTagName('a')[0].addEventListener('click', async e => {
                e.preventDefault();
                history.pushState({}, null, `https://twitter.com/${tweet.user.screen_name}/status/${id}/retweets/with_comments`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let tid = location.pathname.match(/status\/(\d{1,32})/)[1];
                this.updateRetweetsWithComments(tid);
                this.currentLocation = location.pathname;
            });
        }
        if(!this.retweetCursor) {
            this.container.getElementsByClassName('retweets-more')[0].hidden = true;
        } else {
            this.container.getElementsByClassName('retweets-more')[0].hidden = false;
        }
    
        for(let i in tweetRetweeters) {
            let u = tweetRetweeters[i];
            let retweetElement = document.createElement('div');
            retweetElement.classList.add('following-item');
            retweetElement.innerHTML = `
            <div>
                <a href="https://twitter.com/${u.screen_name}" class="following-item-link">
                    <img src="${u.profile_image_url_https}" alt="${u.screen_name}" class="following-item-avatar tweet-avatar" width="48" height="48">
                    <div class="following-item-text">
                        <span class="tweet-header-name following-item-name">${escapeHTML(u.name)}</span><br>
                        <span class="tweet-header-handle">@${u.screen_name}</span>
                    </div>
                </a>
            </div>
            <div>
                <button class="following-item-btn nice-button ${u.following ? 'following' : 'follow'}">${u.following ? 'Following' : 'Follow'}</button>
            </div>`;
    
            let followButton = retweetElement.querySelector('.following-item-btn');
            followButton.addEventListener('click', async () => {
                if (followButton.classList.contains('following')) {
                    await API.unfollowUser(u.screen_name);
                    followButton.classList.remove('following');
                    followButton.classList.add('follow');
                    followButton.innerText = 'Follow';
                } else {
                    await API.followUser(u.screen_name);
                    followButton.classList.remove('follow');
                    followButton.classList.add('following');
                    followButton.innerText = 'Following';
                }
            });
    
            retweetDiv.appendChild(retweetElement);
        }
    }
    async updateRetweetsWithComments(id, c) {
        let tweetRetweeters;
        try {
            tweetRetweeters = await API.getTweetQuotes(id, c);
            this.retweetCommentsCursor = tweetRetweeters.cursor;
            tweetRetweeters = tweetRetweeters.list;
        } catch(e) {
            console.error(e);
            return this.retweetCommentsCursor = undefined;
        }
        let retweetDiv = document.getElementsByClassName('retweets_with_comments')[0];
    
        if(!c) {
            retweetDiv.innerHTML = '';
            let h1 = document.createElement('h1');
            h1.innerHTML = `Quote tweets (<a href="https://twitter.com/aabehhh/status/${id}/retweets">see retweets</a>)`;
            h1.className = 'cool-header';
            retweetDiv.appendChild(h1);
            h1.getElementsByTagName('a')[0].addEventListener('click', async e => {
                e.preventDefault();
                let t = await API.getTweet(id);
                history.pushState({}, null, `https://twitter.com/${t.user.screen_name}/status/${id}/retweets`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let tid = location.pathname.match(/status\/(\d{1,32})/)[1];
                this.updateRetweets(tid);
                this.currentLocation = location.pathname;
            });
        }
        if(!this.retweetCommentsCursor) {
            this.container.getElementsByClassName('retweets_with_comments-more')[0].hidden = true;
        } else {
            this.container.getElementsByClassName('retweets_with_comments-more')[0].hidden = false;
        }
    
        for(let i in tweetRetweeters) {
            await this.appendTweet(tweetRetweeters[i], retweetDiv);
        }
    }
    async appendComposeComponent(container, replyTweet) {
        if(!replyTweet) return;
        this.tweets.push(['compose', replyTweet]);
        let el = document.createElement('div');
        el.className = 'new-tweet-container';
        el.innerHTML = /*html*/`
            <div class="new-tweet-view box">
                <img width="35" height="35" class="tweet-avatar new-tweet-avatar">
                <span class="new-tweet-char" hidden>0/280</span>
                <textarea class="new-tweet-text" placeholder="Reply to @${replyTweet.user.screen_name}" maxlength="280"></textarea>
                <div class="new-tweet-user-search box" hidden></div>
                <div class="new-tweet-media-div">
                    <span class="new-tweet-media"></span>
                </div>
                <div class="new-tweet-focused" hidden>
                    <div class="new-tweet-media-cc"><div class="new-tweet-media-c"></div></div>
                    <button class="new-tweet-button nice-button">Tweet</button>
                    <br><br>
                </div>
            </div>`;
        container.append(el);
        document.getElementsByClassName('new-tweet-avatar')[0].src = this.user.profile_image_url_https.replace("_normal", "_bigger");
        document.getElementsByClassName('new-tweet-view')[0].addEventListener('click', async () => {
            document.getElementsByClassName('new-tweet-focused')[0].hidden = false;
            document.getElementsByClassName('new-tweet-char')[0].hidden = false;
            document.getElementsByClassName('new-tweet-text')[0].classList.add('new-tweet-text-focused');
            document.getElementsByClassName('new-tweet-media-div')[0].classList.add('new-tweet-media-div-focused');
        });
        
        document.getElementsByClassName('new-tweet-view')[0].addEventListener('drop', e => {
            handleDrop(e, this.mediaToUpload, document.getElementsByClassName('new-tweet-media-c')[0]);
        });
        document.getElementsByClassName('new-tweet-media-div')[0].addEventListener('click', async () => {
            getMedia(this.mediaToUpload, document.getElementsByClassName('new-tweet-media-c')[0]);
        });
        let newTweetUserSearch = document.getElementsByClassName("new-tweet-user-search")[0];
        let newTweetText = document.getElementsByClassName('new-tweet-text')[0];
        let selectedIndex = 0;
        newTweetText.addEventListener('focus', async e => {
            setTimeout(() => {
                if(/(?<!\w)@([\w+]{1,15}\b)$/.test(e.target.value)) {
                    newTweetUserSearch.hidden = false;
                } else {
                    newTweetUserSearch.hidden = true;
                    newTweetUserSearch.innerHTML = '';
                }
            }, 10);
        });
        newTweetText.addEventListener('blur', async e => {
            setTimeout(() => {
                newTweetUserSearch.hidden = true;
            }, 100);
        });
        newTweetText.addEventListener('keypress', async e => {
            if ((e.key === 'Enter' || e.key === 'Tab') && !newTweetUserSearch.hidden) {
                let activeSearch = newTweetUserSearch.querySelector('.search-result-item-active');
                if(!e.ctrlKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    newTweetText.value = newTweetText.value.split("@").slice(0, -1).join('@').split(" ").slice(0, -1).join(" ") + ` @${activeSearch.querySelector('.search-result-item-screen-name').innerText.slice(1)} `;
                    if(newTweetText.value.startsWith(" ")) newTweetText.value = newTweetText.value.slice(1);
                    if(newTweetText.value.length > 280) newTweetText.value = newTweetText.value.slice(0, 280);
                    newTweetUserSearch.innerHTML = '';
                    newTweetUserSearch.hidden = true;
                }
            }
        });
        newTweetText.addEventListener('keydown', async e => {
            if(e.key === 'ArrowDown') {
                if(selectedIndex < newTweetUserSearch.children.length - 1) {
                    selectedIndex++;
                    newTweetUserSearch.children[selectedIndex].classList.add('search-result-item-active');
                    newTweetUserSearch.children[selectedIndex - 1].classList.remove('search-result-item-active');
                } else {
                    selectedIndex = 0;
                    newTweetUserSearch.children[selectedIndex].classList.add('search-result-item-active');
                    newTweetUserSearch.children[newTweetUserSearch.children.length - 1].classList.remove('search-result-item-active');
                }
                return;
            }
            if(e.key === 'ArrowUp') {
                if(selectedIndex > 0) {
                    selectedIndex--;
                    newTweetUserSearch.children[selectedIndex].classList.add('search-result-item-active');
                    newTweetUserSearch.children[selectedIndex + 1].classList.remove('search-result-item-active');
                } else {
                    selectedIndex = newTweetUserSearch.children.length - 1;
                    newTweetUserSearch.children[selectedIndex].classList.add('search-result-item-active');
                    newTweetUserSearch.children[0].classList.remove('search-result-item-active');
                }
                return;
            }
            if(/(?<!\w)@([\w+]{1,15}\b)$/.test(e.target.value)) {
                newTweetUserSearch.hidden = false;
                selectedIndex = 0;
                let users = (await API.search(e.target.value.match(/@([\w+]{1,15}\b)$/)[1])).users;
                newTweetUserSearch.innerHTML = '';
                users.forEach((user, index) => {
                    let userElement = document.createElement('span');
                    userElement.className = 'search-result-item';
                    if(index === 0) userElement.classList.add('search-result-item-active');
                    userElement.innerHTML = `
                        <img width="16" height="16" class="search-result-item-avatar" src="${user.profile_image_url_https}">
                        <span class="search-result-item-name ${user.verified ? 'search-result-item-verified' : ''}">${escapeHTML(user.name)}</span>
                        <span class="search-result-item-screen-name">@${user.screen_name}</span>
                    `;
                    userElement.addEventListener('click', () => {
                        newTweetText.value = newTweetText.value.split("@").slice(0, -1).join('@').split(" ").slice(0, -1).join(" ") + ` @${user.screen_name} `;
                        if(newTweetText.value.startsWith(" ")) newTweetText.value = newTweetText.value.slice(1);
                        if(newTweetText.value.length > 280) newTweetText.value = newTweetText.value.slice(0, 280);
                        newTweetText.focus();
                        newTweetUserSearch.innerHTML = '';
                        newTweetUserSearch.hidden = true;
                    });
                    newTweetUserSearch.appendChild(userElement);
                });
            } else {
                newTweetUserSearch.innerHTML = '';
                newTweetUserSearch.hidden = true;
            }
            if (e.key === 'Enter') {
                if(e.ctrlKey) document.getElementsByClassName('new-tweet-button')[0].click();
            }
            let charElement = document.getElementsByClassName('new-tweet-char')[0];
            charElement.innerText = `${e.target.value.length}/280`;
            if (e.target.value.length > 265) {
                charElement.style.color = "#c26363";
            } else {
                charElement.style.color = "";
            }
        });
        document.getElementsByClassName('new-tweet-text')[0].addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.ctrlKey) {
                document.getElementsByClassName('new-tweet-button')[0].click();
            }
            let charElement = document.getElementsByClassName('new-tweet-char')[0];
            charElement.innerText = `${e.target.value.length}/280`;
            if (e.target.value.length > 265) {
                charElement.style.color = "#c26363";
            } else {
                charElement.style.color = "";
            }
        });
        document.getElementsByClassName('new-tweet-text')[0].addEventListener('keyup', e => {
            let charElement = document.getElementsByClassName('new-tweet-char')[0];
            charElement.innerText = `${e.target.value.length}/280`;
            charElement.innerText = `${e.target.value.length}/280`;
            if (e.target.value.length > 265) {
                charElement.style.color = "#c26363";
            } else {
                charElement.style.color = "";
            }
        });
        document.getElementsByClassName('new-tweet-button')[0].addEventListener('click', async () => {
            let tweet = document.getElementsByClassName('new-tweet-text')[0].value;
            if (tweet.length === 0 && mediaToUpload.length === 0) return;
            document.getElementsByClassName('new-tweet-button')[0].disabled = true;
            let uploadedMedia = [];
            for (let i in this.mediaToUpload) {
                let media = this.mediaToUpload[i];
                try {
                    media.div.getElementsByClassName('new-tweet-media-img-progress')[0].hidden = false;
                    let mediaId = await API.uploadMedia({
                        media_type: media.type,
                        media_category: media.category,
                        media: media.data,
                        alt: media.alt,
                        loadCallback: data => {
                            media.div.getElementsByClassName('new-tweet-media-img-progress')[0].innerText = `${data.text} (${data.progress}%)`;
                        }
                    });
                    uploadedMedia.push(mediaId);
                } catch (e) {
                    media.div.getElementsByClassName('new-tweet-media-img-progress')[0].hidden = true;
                    console.error(e);
                    alert(e);
                }
            }
            let tweetObject = {
                status: tweet,
                in_reply_to_status_id: replyTweet.id_str,
                auto_populate_reply_metadata: true,
                batch_mode: 'off',
                exclude_reply_user_ids: '',
                cards_platform: 'Web-13',
                include_entities: 1,
                include_user_entities: 1,
                include_cards: 1,
                send_error_codes: 1,
                tweet_mode: 'extended',
                include_ext_alt_text: true,
                include_reply_count: true
            };
            if (uploadedMedia.length > 0) {
                tweetObject.media_ids = uploadedMedia.join(',');
            }
            try {
                let tweet = await API.postTweet(tweetObject);
                tweet._ARTIFICIAL = true;
                this.appendTweet(tweet, document.getElementsByClassName('timeline')[0], {
                    after: document.getElementsByClassName('new-tweet-view')[0].parentElement
                });
            } catch (e) {
                document.getElementsByClassName('new-tweet-button')[0].disabled = false;
                console.error(e);
            }
            document.getElementsByClassName('new-tweet-text')[0].value = "";
            document.getElementsByClassName('new-tweet-media-c')[0].innerHTML = "";
            this.mediaToUpload = [];
            document.getElementsByClassName('new-tweet-focused')[0].hidden = true;
            document.getElementsByClassName('new-tweet-char')[0].hidden = true;
            document.getElementsByClassName('new-tweet-text')[0].classList.remove('new-tweet-text-focused');
            document.getElementsByClassName('new-tweet-media-div')[0].classList.remove('new-tweet-media-div-focused');
            document.getElementsByClassName('new-tweet-button')[0].disabled = false;
        });
    }
    async appendTweet(t, timelineContainer, options = {}) {
        if(this.seenReplies.includes(t.id_str)) return;
        this.tweets.push(['tweet', t, options]);
        this.seenReplies.push(t.id_str);
        const tweet = document.createElement('div');
        if(!options.mainTweet) {
            tweet.addEventListener('click', async e => {
                if(e.target.className.startsWith('tweet tweet-view tweet-id-') || e.target.className === 'tweet-body' || e.target.className === 'tweet-interact') {
                    this.savePageData();
                    history.pushState({}, null, `https://twitter.com/${t.user.screen_name}/status/${t.id_str}`);
                    this.updateSubpage();
                    this.mediaToUpload = [];
                    this.linkColors = {};
                    this.cursor = undefined;
                    this.seenReplies = [];
                    this.mainTweetLikers = [];
                    let restored = await this.restorePageData();
                    let id = location.pathname.match(/status\/(\d{1,32})/)[1];
                    if(this.subpage === 'tweet' && !restored) {
                        this.updateReplies(id);
                    } else if(this.subpage === 'likes') {
                        this.updateLikes(id);
                    } else if(this.subpage === 'retweets') {
                        this.updateRetweets(id);
                    } else if(this.subpage === 'retweets_with_comments') {
                        this.updateRetweetsWithComments(id);
                    }
                    this.currentLocation = location.pathname;
                }
            });
            tweet.addEventListener('mousedown', e => {
                if(e.button === 1) {
                    e.preventDefault();
                    if(e.target.className.startsWith('tweet tweet-view tweet-id-') || e.target.className === 'tweet-body' || e.target.className === 'tweet-interact') {
                        openInNewTab(`https://twitter.com/${t.user.screen_name}/status/${t.id_str}`);
                    }
                }
            });
        }
        tweet.tabIndex = -1;
        tweet.className = `tweet tweet-view tweet-id-${t.id_str} ${options.mainTweet ? 'tweet-main' : 'tweet-replying'}`;
        if(!this.activeTweet) {
            tweet.classList.add('tweet-active');
            this.activeTweet = tweet;
        }
        if (options.threadContinuation) tweet.classList.add('tweet-self-thread-continuation');
        if (options.noTop) tweet.classList.add('tweet-no-top');
        if(vars.linkColorsInTL) {
            if(this.linkColors[t.user.screen_name]) {
                let rgb = hex2rgb(this.linkColors[t.user.screen_name]);
                let ratio = contrast(rgb, [27, 40, 54]);
                if(ratio < 4 && vars.darkMode && this.linkColors[t.user.screen_name] !== '000000') {
                    this.linkColors[t.user.screen_name] = colorShade(this.linkColors[t.user.screen_name], 80).slice(1);
                }
                tweet.style.setProperty('--link-color', '#'+this.linkColors[t.user.screen_name]);
            } else {
                if(t.user.profile_link_color && t.user.profile_link_color !== '1DA1F2') {
                    let rgb = hex2rgb(t.user.profile_link_color);
                    let ratio = contrast(rgb, [27, 40, 54]);
                    if(ratio < 4 && vars.darkMode && this.linkColors[t.user.screen_name] !== '000000') {
                        t.user.profile_link_color = colorShade(t.user.profile_link_color, 80).slice(1);
                    }
                    tweet.style.setProperty('--link-color', '#'+t.user.profile_link_color);
                }
            }
        }
        t.full_text = t.full_text.replace(/^((?<!\w)@([\w+]{1,15})\s)+/, '')
        let textWithoutLinks = t.full_text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '').replace(/(?<!\w)@([\w+]{1,15}\b)/g, '');
        let isEnglish = textWithoutLinks.length < 1 ? {languages:[{language:'en', percentage:100}]} : await chrome.i18n.detectLanguage(textWithoutLinks);
        isEnglish = isEnglish.languages[0] && isEnglish.languages[0].percentage > 60 && isEnglish.languages[0].language.startsWith('en');
        tweet.innerHTML = /*html*/`
            <div class="tweet-top" hidden></div>
            <a class="tweet-avatar-link" href="https://twitter.com/${t.user.screen_name}"><img onerror="this.src = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_bigger.png'" src="${t.user.profile_image_url_https.replace("_normal.", "_bigger.")}" alt="${t.user.name}" class="tweet-avatar" width="48" height="48"></a>
            <div class="tweet-header ${options.mainTweet ? 'tweet-header-main' : ''}">
                <a class="tweet-header-info ${options.mainTweet ? 'tweet-header-info-main' : ''}" href="https://twitter.com/${t.user.screen_name}">
                    <b class="tweet-header-name ${options.mainTweet ? 'tweet-header-name-main' : ''} ${t.user.verified || t.user.id_str === '1123203847776763904' ? 'user-verified' : ''} ${t.user.protected ? 'user-protected' : ''}">${escapeHTML(t.user.name)}</b>
                    <span class="tweet-header-handle">@${t.user.screen_name}</span>
                </a>
                ${options.mainTweet && t.user.id_str !== user.id_str ? `<button class='nice-button tweet-header-follow ${t.user.following ? 'following' : 'follow'}'>${t.user.following ? 'Following' : 'Follow'}</button>` : ''}
            </div>
            <a ${options.mainTweet ? 'hidden' : ''} class="tweet-time" data-timestamp="${new Date(t.created_at).getTime()}" title="${new Date(t.created_at).toLocaleString()}" href="https://twitter.com/${t.user.screen_name}/status/${t.id_str}">${timeElapsed(new Date(t.created_at).getTime())}</a>
            <div class="tweet-body ${options.mainTweet ? 'tweet-body-main' : ''}">
                <span class="tweet-body-text ${(t.full_text && t.full_text.length > 100) || !options.mainTweet ? 'tweet-body-text-long' : 'tweet-body-text-short'}">${t.full_text ? escapeHTML(t.full_text).replace(/\n/g, '<br>').replace(/((http|https|ftp):\/\/[\w?=&.\/-;#~%-]+(?![\w\s?&.\/;#~%"=-]*>))/g, '<a href="$1">$1</a>').replace(/(?<!\w)@([\w+]{1,15}\b)/g, `<a href="https://twitter.com/$1">@$1</a>`).replace(/(?<!\w)#([\w+]+\b)/g, `<a href="https://twitter.com/hashtag/$1">#$1</a>`) : ''}</span>
                ${!isEnglish ? `
                <br>
                <span class="tweet-translate">View translation</span>
                ` : ``}
                ${t.extended_entities && t.extended_entities.media ? `
                <div class="tweet-media">
                    ${t.extended_entities.media.map(m => `<${m.type === 'photo' ? 'img' : 'video'} ${m.ext_alt_text ? `alt="${escapeHTML(m.ext_alt_text)}" title="${escapeHTML(m.ext_alt_text)}"` : ''} crossorigin="anonymous" width="${sizeFunctions[t.extended_entities.media.length](m.original_info.width, m.original_info.height)[0]}" height="${sizeFunctions[t.extended_entities.media.length](m.original_info.width, m.original_info.height)[1]}" loading="lazy" ${m.type === 'video' ? 'controls' : ''} ${m.type === 'animated_gif' ? 'loop autoplay muted' : ''} ${m.type === 'photo' ? `src="${m.media_url_https}"` : ''} class="tweet-media-element ${mediaClasses[t.extended_entities.media.length]} ${!settings.display_sensitive_media && t.possibly_sensitive ? 'tweet-media-element-censor' : ''}">${m.type === 'video' || m.type === 'animated_gif' ? `
                        ${m.video_info.variants.map(v => `<source src="${v.url}" type="${v.content_type}">`).join('\n')}
                        Your browser does not support this video.
                    </video>` : ''}`).join('\n')}
                </div>
                ` : ``}
                ${t.card ? `<div class="tweet-poll"></div>` : ''}
                ${t.quoted_status ? `
                <a class="tweet-body-quote" href="https://twitter.com/${t.quoted_status.user.screen_name}/status/${t.quoted_status.id_str}">
                    <img src="${t.quoted_status.user.profile_image_url_https}" alt="${escapeHTML(t.quoted_status.user.name)}" class="tweet-avatar-quote" width="24" height="24">
                    <div class="tweet-header-quote">
                        <span class="tweet-header-info-quote">
                        <b class="tweet-header-name-quote ${t.quoted_status.user.verified || t.quoted_status.user.id_str === '1123203847776763904' ? 'user-verified' : ''} ${t.quoted_status.user.protected ? 'user-protected' : ''}">${escapeHTML(t.quoted_status.user.name)}</b>
                        <span class="tweet-header-handle-quote">@${t.quoted_status.user.screen_name}</span>
                        </span>
                    </div>
                    <span class="tweet-time-quote" data-timestamp="${new Date(t.quoted_status.created_at).getTime()}" title="${new Date(t.quoted_status.created_at).toLocaleString()}">${timeElapsed(new Date(t.quoted_status.created_at).getTime())}</span>
                    <span class="tweet-body-text-quote tweet-body-text-long" style="color:var(--default-text-color)!important">${t.quoted_status.full_text ? escapeHTML(t.quoted_status.full_text).replace(/\n/g, '<br>') : ''}</span>
                    ${t.quoted_status.extended_entities && t.quoted_status.extended_entities.media ? `
                    <div class="tweet-media-quote">
                        ${t.quoted_status.extended_entities.media.map(m => `<${m.type === 'photo' ? 'img' : 'video'} ${m.ext_alt_text ? `alt="${escapeHTML(m.ext_alt_text)}" title="${escapeHTML(m.ext_alt_text)}"` : ''} crossorigin="anonymous" width="${quoteSizeFunctions[t.quoted_status.extended_entities.media.length](m.original_info.width, m.original_info.height)[0]}" height="${quoteSizeFunctions[t.quoted_status.extended_entities.media.length](m.original_info.width, m.original_info.height)[1]}" loading="lazy" ${m.type === 'video' ? 'controls' : ''} ${m.type === 'animated_gif' ? 'loop autoplay muted' : ''} src="${m.type === 'photo' ? m.media_url_https : m.video_info.variants.find(v => v.content_type === 'video/mp4').url}" class="tweet-media-element tweet-media-element-quote ${mediaClasses[t.quoted_status.extended_entities.media.length]} ${!settings.display_sensitive_media && t.quoted_status.possibly_sensitive ? 'tweet-media-element-censor' : ''}">${m.type === 'video' ? '</video>' : ''}`).join('\n')}
                    </div>
                    ` : ''}
                </a>
                ` : ``}
                ${t.limited_actions === 'limit_trusted_friends_tweet' && options.mainTweet ? `
                <div class="tweet-limited">
                    This tweet is visible only to people who are in @${t.user.screen_name}'s trusted friends circle.<br>
                    <a href="https://help.twitter.com/en/using-twitter/twitter-circle" target="_blank">Learn more.</a>
                </div>
                ` : ''}
                ${t.tombstone ? `<div class="tweet-warning">${t.tombstone}</div>` : ''}
                ${options.mainTweet ? /*html*/`
                <div class="tweet-footer">
                    <div class="tweet-footer-stats">
                        <div class="tweet-footer-stat">
                            <span class="tweet-footer-stat-text">Replies</span>
                            <b class="tweet-footer-stat-count tweet-footer-stat-replies">${Number(t.reply_count).toLocaleString().replace(/\s/g, ',')}</b>
                        </div>
                        <a href="https://twitter.com/${t.user.screen_name}/status/${t.id_str}/retweets/with_comments" class="tweet-footer-stat tweet-footer-stat-r">
                            <span class="tweet-footer-stat-text">Retweets</span>
                            <b class="tweet-footer-stat-count tweet-footer-stat-retweets">${Number(t.retweet_count).toLocaleString().replace(/\s/g, ',')}</b>
                        </a>
                        <a href="https://twitter.com/${t.user.screen_name}/status/${t.id_str}/likes" class="tweet-footer-stat tweet-footer-stat-f">
                            <span class="tweet-footer-stat-text">Favorites</span>
                            <b class="tweet-footer-stat-count tweet-footer-stat-favorites">${Number(t.favorite_count).toLocaleString().replace(/\s/g, ',')}</b>
                        </a>
                    </div>
                    <div class="tweet-footer-favorites"></div>
                </div>
                ` : ''}
                <a ${!options.mainTweet ? 'hidden' : ''} class="tweet-date" title="${new Date(t.created_at).toLocaleString()}" href="https://twitter.com/${t.user.screen_name}/status/${t.id_str}"><br>${new Date(t.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' }).toLowerCase()} - ${new Date(t.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}  ・ ${t.source.split('>')[1].split('<')[0]}</a>
                <div class="tweet-interact">
                    <span class="tweet-interact-reply" data-val="${t.reply_count}">${options.mainTweet ? '' : t.reply_count}</span>
                    <span class="tweet-interact-retweet ${t.retweeted ? 'tweet-interact-retweeted' : ''}" data-val="${t.retweet_count}">${options.mainTweet ? '' : t.retweet_count}</span>
                    <div class="tweet-interact-retweet-menu" hidden>
                        <span class="tweet-interact-retweet-menu-retweet">${t.retweeted ? 'Unretweet' : 'Retweet'}</span><br>
                        <span class="tweet-interact-retweet-menu-quote">Quote tweet</span><br>
                        ${options.mainTweet ? `
                            <span class="tweet-interact-retweet-menu-quotes">See quotes</span><br>
                            <span class="tweet-interact-retweet-menu-retweeters">See retweeters</span><br>
                        ` : ''}
                    </div>
                    <span class="tweet-interact-favorite ${t.favorited ? 'tweet-interact-favorited' : ''}" data-val="${t.favorite_count}">${options.mainTweet ? '' : t.favorite_count}</span>
                    <span class="tweet-interact-more"></span>
                    <div class="tweet-interact-more-menu" hidden>
                        <span class="tweet-interact-more-menu-copy">Copy link</span><br>
                        <span class="tweet-interact-more-menu-embed">Embed tweet</span><br>
                        <span class="tweet-interact-more-menu-share">Share tweet</span><br>
                        ${t.user.id_str === user.id_str ? `
                        <hr>
                        <span class="tweet-interact-more-menu-analytics">Tweet analytics</span><br>
                        <span class="tweet-interact-more-menu-delete">Delete tweet</span><br>
                        ` : ``}
                        ${t.user.id_str !== user.id_str && !options.mainTweet ? `
                        <hr>
                        <span class="tweet-interact-more-menu-follow">${t.user.following ? 'Unfollow' : 'Follow'} @${t.user.screen_name}</span><br>
                        ` : ''}
                        <span class="tweet-interact-more-menu-bookmark">Bookmark tweet</span>
                        <hr>
                        <span class="tweet-interact-more-menu-refresh">Refresh tweet data</span><br>
                        ${t.extended_entities && t.extended_entities.media.length === 1 ? `<span class="tweet-interact-more-menu-download">Download media</span><br>` : ``}
                        ${t.extended_entities && t.extended_entities.media.length === 1 && t.extended_entities.media[0].type === 'animated_gif' ? `<span class="tweet-interact-more-menu-download-gif">Download as GIF</span><br>` : ``}
                    </div>
                </div>
                <div class="tweet-reply" hidden>
                    <br>
                    <b style="font-size: 12px;display: block;margin-bottom: 5px;">Replying to tweet <span class="tweet-reply-upload">[upload media]</span> <span class="tweet-reply-cancel">[cancel]</span></b>
                    <span class="tweet-reply-error" style="color:red"></span>
                    <textarea maxlength="280" class="tweet-reply-text" placeholder="Cool reply tweet"></textarea>
                    <button class="tweet-reply-button nice-button">Reply</button><br>
                    <span class="tweet-reply-char">0/280</span><br>
                    <div class="tweet-reply-media" style="padding-bottom: 10px;"></div>
                </div>
                <div class="tweet-quote" hidden>
                    <br>
                    <b style="font-size: 12px;display: block;margin-bottom: 5px;">Quote tweet <span class="tweet-quote-upload">[upload media]</span> <span class="tweet-quote-cancel">[cancel]</span></b>
                    <span class="tweet-quote-error" style="color:red"></span>
                    <textarea maxlength="280" class="tweet-quote-text" placeholder="Cool quote tweet"></textarea>
                    <button class="tweet-quote-button nice-button">Quote</button><br>
                    <span class="tweet-quote-char">0/280</span><br>
                    <div class="tweet-quote-media" style="padding-bottom: 10px;"></div>
                </div>
                <div class="tweet-view-self-thread-div" ${options.threadContinuation ? '' : 'hidden'}>
                    <span class="tweet-view-self-thread-line"></span>
                    <div class="tweet-view-self-thread-line-dots"></div>
                </div>
            </div>
        `;
        let footerFavorites = tweet.getElementsByClassName('tweet-footer-favorites')[0];
        if(t.card) {
            generateCard(t, tweet, user);
        }
        if (options.top) {
            tweet.querySelector('.tweet-top').hidden = false;
            const icon = document.createElement('span');
            icon.innerText = options.top.icon;
            icon.classList.add('tweet-top-icon');
            icon.style.color = options.top.color;
    
            const span = document.createElement("span");
            span.classList.add("tweet-top-text");
            span.innerHTML = options.top.text;
            tweet.querySelector('.tweet-top').append(icon, span);
        }
        if(options.mainTweet) {
            let likers = this.mainTweetLikers.slice(0, 8);
            for(let i in likers) {
                let liker = likers[i];
                let a = document.createElement('a');
                a.href = `https://twitter.com/${liker.screen_name}`;
                let likerImg = document.createElement('img');
                likerImg.src = liker.profile_image_url_https;
                likerImg.classList.add('tweet-footer-favorites-img');
                likerImg.title = liker.name + ' (@' + liker.screen_name + ')';
                likerImg.width = 24;
                likerImg.height = 24;
                a.appendChild(likerImg);
                a.dataset.id = liker.id_str;
                footerFavorites.appendChild(a);
            }
            let likesLink = tweet.getElementsByClassName('tweet-footer-stat-f')[0];
            likesLink.addEventListener('click', e => {
                e.preventDefault();
                history.pushState({}, null, `https://twitter.com/${t.user.screen_name}/status/${t.id_str}/likes`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let id = location.pathname.match(/status\/(\d{1,32})/)[1];
                this.updateLikes(id);
                this.currentLocation = location.pathname;
            });
            let retweetsLink = tweet.getElementsByClassName('tweet-footer-stat-r')[0];
            retweetsLink.addEventListener('click', e => {
                e.preventDefault();
                history.pushState({}, null, `https://twitter.com/${t.user.screen_name}/status/${t.id_str}/retweets/with_comments`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let id = location.pathname.match(/status\/(\d{1,32})/)[1];
                this.updateRetweetsWithComments(id);
                this.currentLocation = location.pathname;
            });
        }
        if(options.mainTweet && t.user.id_str !== user.id_str) {
            const tweetFollow = tweet.getElementsByClassName('tweet-header-follow')[0];
            tweetFollow.addEventListener('click', async () => {
                if(t.user.following) {
                    await API.unfollowUser(t.user.screen_name);
                    tweetFollow.innerText = 'Follow';
                    tweetFollow.classList.remove('following');
                    tweetFollow.classList.add('follow');
                    t.user.following = false;
                } else {
                    await API.followUser(t.user.screen_name);
                    tweetFollow.innerText = 'Unfollow';
                    tweetFollow.classList.remove('follow');
                    tweetFollow.classList.add('following');
                    t.user.following = true;
                }
            });
        }
        const tweetBodyText = tweet.getElementsByClassName('tweet-body-text')[0];
        const tweetTranslate = tweet.getElementsByClassName('tweet-translate')[0];
        const tweetBodyQuote = tweet.getElementsByClassName('tweet-body-quote')[0];
    
        const tweetReplyCancel = tweet.getElementsByClassName('tweet-reply-cancel')[0];
        const tweetReplyUpload = tweet.getElementsByClassName('tweet-reply-upload')[0];
        const tweetReply = tweet.getElementsByClassName('tweet-reply')[0];
        const tweetReplyButton = tweet.getElementsByClassName('tweet-reply-button')[0];
        const tweetReplyError = tweet.getElementsByClassName('tweet-reply-error')[0];
        const tweetReplyText = tweet.getElementsByClassName('tweet-reply-text')[0];
        const tweetReplyChar = tweet.getElementsByClassName('tweet-reply-char')[0];
        const tweetReplyMedia = tweet.getElementsByClassName('tweet-reply-media')[0];
    
        const tweetInteractReply = tweet.getElementsByClassName('tweet-interact-reply')[0];
        const tweetInteractRetweet = tweet.getElementsByClassName('tweet-interact-retweet')[0];
        const tweetInteractFavorite = tweet.getElementsByClassName('tweet-interact-favorite')[0];
        const tweetInteractMore = tweet.getElementsByClassName('tweet-interact-more')[0];
    
        const tweetFooterReplies = tweet.getElementsByClassName('tweet-footer-stat-replies')[0];
        const tweetFooterRetweets = tweet.getElementsByClassName('tweet-footer-stat-retweets')[0];
        const tweetFooterFavorites = tweet.getElementsByClassName('tweet-footer-stat-favorites')[0];
    
        const tweetQuote = tweet.getElementsByClassName('tweet-quote')[0];
        const tweetQuoteCancel = tweet.getElementsByClassName('tweet-quote-cancel')[0];
        const tweetQuoteUpload = tweet.getElementsByClassName('tweet-quote-upload')[0];
        const tweetQuoteButton = tweet.getElementsByClassName('tweet-quote-button')[0];
        const tweetQuoteError = tweet.getElementsByClassName('tweet-quote-error')[0];
        const tweetQuoteText = tweet.getElementsByClassName('tweet-quote-text')[0];
        const tweetQuoteChar = tweet.getElementsByClassName('tweet-quote-char')[0];
        const tweetQuoteMedia = tweet.getElementsByClassName('tweet-quote-media')[0];
    
        const tweetInteractRetweetMenu = tweet.getElementsByClassName('tweet-interact-retweet-menu')[0];
        const tweetInteractRetweetMenuRetweet = tweet.getElementsByClassName('tweet-interact-retweet-menu-retweet')[0];
        const tweetInteractRetweetMenuQuote = tweet.getElementsByClassName('tweet-interact-retweet-menu-quote')[0];
        const tweetInteractRetweetMenuQuotes = tweet.getElementsByClassName('tweet-interact-retweet-menu-quotes')[0];
        const tweetInteractRetweetMenuRetweeters = tweet.getElementsByClassName('tweet-interact-retweet-menu-retweeters')[0];
    
        const tweetInteractMoreMenu = tweet.getElementsByClassName('tweet-interact-more-menu')[0];
        const tweetInteractMoreMenuCopy = tweet.getElementsByClassName('tweet-interact-more-menu-copy')[0];
        const tweetInteractMoreMenuEmbed = tweet.getElementsByClassName('tweet-interact-more-menu-embed')[0];
        const tweetInteractMoreMenuShare = tweet.getElementsByClassName('tweet-interact-more-menu-share')[0];
        const tweetInteractMoreMenuAnalytics = tweet.getElementsByClassName('tweet-interact-more-menu-analytics')[0];
        const tweetInteractMoreMenuRefresh = tweet.getElementsByClassName('tweet-interact-more-menu-refresh')[0];
        const tweetInteractMoreMenuDownload = tweet.getElementsByClassName('tweet-interact-more-menu-download')[0];
        const tweetInteractMoreMenuDownloadGif = tweet.getElementsByClassName('tweet-interact-more-menu-download-gif')[0];
        const tweetInteractMoreMenuDelete = tweet.getElementsByClassName('tweet-interact-more-menu-delete')[0];
        const tweetInteractMoreMenuFollow = tweet.getElementsByClassName('tweet-interact-more-menu-follow')[0];
        const tweetInteractMoreMenuBookmark = tweet.getElementsByClassName('tweet-interact-more-menu-bookmark')[0];
    
        if(tweetBodyQuote) {
            tweetBodyQuote.addEventListener('click', e => {
                e.preventDefault();
                history.pushState({}, null, `https://twitter.com/${t.quoted_status.user.screen_name}/status/${t.quoted_status.id_str}`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let id = location.pathname.match(/status\/(\d{1,32})/)[1];
                if(this.subpage === 'tweet') {
                    this.updateReplies(id);
                } else if(this.subpage === 'likes') {
                    this.updateLikes(id);
                } else if(this.subpage === 'retweets') {
                    this.updateRetweets(id);
                } else if(this.subpage === 'retweets_with_comments') {
                    this.updateRetweetsWithComments(id);
                }
                this.currentLocation = location.pathname;
            });
        }
    
        // Translate
        if(tweetTranslate) tweetTranslate.addEventListener('click', async () => {
            let translated = await API.translateTweet(t.id_str);
            tweetTranslate.hidden = true;
            tweetBodyText.innerHTML += `<br>
            <span style="font-size: 12px;color: var(--light-gray);">Translated from [${translated.translated_lang}]:</span>
            <br>
            <span>${escapeHTML(translated.text)}</span>`;
            twemoji.parse(tweetBodyText);
        });

        tweetInteractMoreMenuBookmark.addEventListener('click', async () => {
            API.createBookmark(t.id_str);
        });    
    
        // Media
        if (t.extended_entities && t.extended_entities.media) {
            const tweetMedia = tweet.getElementsByClassName('tweet-media')[0];
            tweetMedia.addEventListener('click', e => {
                if (e.target.className.includes('tweet-media-element-censor')) {
                    return e.target.classList.remove('tweet-media-element-censor');
                }
                if (e.target.tagName === 'IMG') {
                    new Viewer(tweetMedia);
                    e.target.click();
                }
            });
        }
    
        // Links
        if (tweetBodyText && tweetBodyText.lastChild && tweetBodyText.lastChild.href && tweetBodyText.lastChild.href.startsWith('https://t.co/')) {
            if (t.entities.urls.length === 0 || t.entities.urls[t.entities.urls.length - 1].url !== tweetBodyText.lastChild.href) {
                tweetBodyText.lastChild.remove();
            }
        }
        let links = Array.from(tweetBodyText.getElementsByTagName('a')).filter(a => a.href.startsWith('https://t.co/'));
        links.forEach(a => {
            let link = t.entities.urls.find(u => u.url === a.href);
            if (link) {
                a.innerText = link.display_url;
                a.href = link.expanded_url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
            }
        });
    
        // Reply
        tweetReplyCancel.addEventListener('click', () => {
            tweetReply.hidden = true;
            tweetInteractReply.classList.remove('tweet-interact-reply-clicked');
        });
        let replyMedia = [];
        tweetReply.addEventListener('drop', e => {
            handleDrop(e, replyMedia, tweetReplyMedia);
        });
        tweetReplyUpload.addEventListener('click', () => {
            getMedia(replyMedia, tweetReplyMedia);
        });
        tweetInteractReply.addEventListener('click', () => {
            if(options.mainTweet) {
                document.getElementsByClassName('new-tweet-view')[0].click();
                document.getElementsByClassName('new-tweet-text')[0].focus();
                return;
            }
            if (!tweetQuote.hidden) tweetQuote.hidden = true;
            if (tweetReply.hidden) {
                tweetInteractReply.classList.add('tweet-interact-reply-clicked');
            } else {
                tweetInteractReply.classList.remove('tweet-interact-reply-clicked');
            }
            tweetReply.hidden = !tweetReply.hidden;
            setTimeout(() => {
                tweetReplyText.focus();
            })
        });
        tweetReplyText.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.ctrlKey) {
                tweetReplyButton.click();
            }
            tweetReplyChar.innerText = `${tweetReplyText.value.length}/280`;
            if(tweetReplyText.value.length > 265) {
                tweetReplyChar.style.color = "#c26363";
            } else {
                tweetReplyChar.style.color = "";
            }
        });
        tweetReplyText.addEventListener('keyup', e => {
            tweetReplyChar.innerText = `${tweetReplyText.value.length}/280`;
            if(tweetReplyText.value.length > 265) {
                tweetReplyChar.style.color = "#c26363";
            } else {
                tweetReplyChar.style.color = "";
            }
        });
        tweetReplyButton.addEventListener('click', async () => {
            tweetReplyError.innerHTML = '';
            let text = tweetReplyText.value;
            if (text.length === 0 && replyMedia.length === 0) return;
            tweetReplyButton.disabled = true;
            let uploadedMedia = [];
            for (let i in replyMedia) {
                let media = replyMedia[i];
                try {
                    media.div.getElementsByClassName('new-tweet-media-img-progress')[0].hidden = false;
                    let mediaId = await API.uploadMedia({
                        media_type: media.type,
                        media_category: media.category,
                        media: media.data,
                        alt: media.alt,
                        loadCallback: data => {
                            media.div.getElementsByClassName('new-tweet-media-img-progress')[0].innerText = `${data.text} (${data.progress}%)`;
                        }
                    });
                    uploadedMedia.push(mediaId);
                } catch (e) {
                    media.div.getElementsByClassName('new-tweet-media-img-progress')[0].hidden = true;
                    console.error(e);
                    alert(e);
                }
            }
            let tweetObject = {
                status: text,
                in_reply_to_status_id: t.id_str,
                auto_populate_reply_metadata: true,
                batch_mode: 'off',
                exclude_reply_user_ids: '',
                cards_platform: 'Web-13',
                include_entities: 1,
                include_user_entities: 1,
                include_cards: 1,
                send_error_codes: 1,
                tweet_mode: 'extended',
                include_ext_alt_text: true,
                include_reply_count: true
            };
            if (uploadedMedia.length > 0) {
                tweetObject.media_ids = uploadedMedia.join(',');
            }
            let tweetData;
            try {
                tweetData = await API.postTweet(tweetObject)
            } catch (e) {
                tweetReplyError.innerHTML = (e && e.message ? e.message : e) + "<br>";
                tweetReplyButton.disabled = false;
                return;
            }
            if (!tweetData) {
                tweetReplyButton.disabled = false;
                tweetReplyError.innerHTML = "Error sending tweet<br>";
                return;
            }
            tweetReplyText.value = '';
            tweetReply.hidden = true;
            tweetInteractReply.classList.remove('tweet-interact-reply-clicked');
            if(!options.mainTweet) {
                tweetInteractReply.dataset.val = parseInt(tweetInteractReply.innerText) + 1;
                tweetInteractReply.innerText = parseInt(tweetInteractReply.innerText) + 1;
            } else {
                tweetFooterReplies.dataset.val = parseInt(tweetFooterReplies.innerText) + 1;
                tweetFooterReplies.innerText = parseInt(tweetFooterReplies.innerText) + 1;
            }
            tweetData._ARTIFICIAL = true;
            if(tweet.getElementsByClassName('tweet-self-thread-div')[0]) tweet.getElementsByClassName('tweet-self-thread-div')[0].hidden = false;
            tweetReplyButton.disabled = false;
            tweetReplyMedia.innerHTML = [];
            replyMedia = [];
            this.appendTweet(tweetData, document.getElementsByClassName('timeline')[0], {
                noTop: true,
                after: tweet
            });
        });
    
        // Retweet / Quote Tweet
        let retweetClicked = false;
        tweetQuoteCancel.addEventListener('click', () => {
            tweetQuote.hidden = true;
        });
        tweetInteractRetweet.addEventListener('click', async () => {
            if (!tweetQuote.hidden) {
                tweetQuote.hidden = true;
                return;
            }
            if (tweetInteractRetweetMenu.hidden) {
                tweetInteractRetweetMenu.hidden = false;
            }
            if(retweetClicked) return;
            retweetClicked = true;
            setTimeout(() => {
                document.body.addEventListener('click', () => {
                    retweetClicked = false;
                    setTimeout(() => tweetInteractRetweetMenu.hidden = true, 50);
                }, { once: true });
            }, 50);
        });
        tweetInteractRetweetMenuRetweet.addEventListener('click', async () => {
            if (!t.retweeted) {
                let tweetData;
                try {
                    tweetData = await API.retweetTweet(t.id_str);
                } catch (e) {
                    console.error(e);
                    return;
                }
                if (!tweetData) {
                    return;
                }
                tweetInteractRetweetMenuRetweet.innerText = 'Unretweet';
                tweetInteractRetweet.classList.add('tweet-interact-retweeted');
                t.retweeted = true;
                t.newTweetId = tweetData.id_str;
                if(!options.mainTweet) {
                    tweetInteractRetweet.dataset.val = parseInt(tweetInteractRetweet.innerText) + 1;
                    tweetInteractRetweet.innerText = parseInt(tweetInteractRetweet.innerText) + 1;
                } else {
                    tweetFooterRetweets.innerText = Number(parseInt(tweetFooterRetweets.innerText.replace(/\s/g, '').replace(/,/g, '').replace(/\./g, '')) + 1).toLocaleString().replace(/\s/g, ',');
                }
            } else {
                let tweetData;
                try {
                    tweetData = await API.deleteTweet(t.current_user_retweet ? t.current_user_retweet.id_str : t.newTweetId);
                } catch (e) {
                    console.error(e);
                    return;
                }
                if (!tweetData) {
                    return;
                }
                tweetInteractRetweetMenuRetweet.innerText = 'Retweet';
                tweetInteractRetweet.classList.remove('tweet-interact-retweeted');
                t.retweeted = false;
                if(!options.mainTweet) {
                    tweetInteractRetweet.dataset.val = parseInt(tweetInteractRetweet.innerText) - 1;
                    tweetInteractRetweet.innerText = parseInt(tweetInteractRetweet.innerText) - 1;
                } else {
                    tweetFooterRetweets.innerText = Number(parseInt(tweetFooterRetweets.innerText.replace(/\s/g, '').replace(/,/g, '').replace(/\./g, '')) - 1).toLocaleString().replace(/\s/g, ',');
                }
                delete t.newTweetId;
            }
        });
        if(options.mainTweet) {
            tweetInteractRetweetMenuQuotes.addEventListener('click', async () => {
                history.pushState({}, null, `https://twitter.com/${t.user.screen_name}/status/${t.id_str}/retweets/with_comments`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let id = location.pathname.match(/status\/(\d{1,32})/)[1];
                if(this.subpage === 'tweet') {
                    this.updateReplies(id);
                } else if(this.subpage === 'likes') {
                    this.updateLikes(id);
                } else if(this.subpage === 'retweets') {
                    this.updateRetweets(id);
                } else if(subpage === 'retweets_with_comments') {
                    this.updateRetweetsWithComments(id);
                }
                this.currentLocation = location.pathname;
            });
            tweetInteractRetweetMenuRetweeters.addEventListener('click', async () => {
                history.pushState({}, null, `https://twitter.com/${t.user.screen_name}/status/${t.id_str}/retweets`);
                this.updateSubpage();
                this.mediaToUpload = [];
                this.linkColors = {};
                this.cursor = undefined;
                this.seenReplies = [];
                this.mainTweetLikers = [];
                let id = location.pathname.match(/status\/(\d{1,32})/)[1];
                if(this.subpage === 'tweet') {
                    this.updateReplies(id);
                } else if(this.subpage === 'likes') {
                    this.updateLikes(id);
                } else if(this.subpage === 'retweets') {
                    this.updateRetweets(id);
                } else if(this.subpage === 'retweets_with_comments') {
                    this.updateRetweetsWithComments(id);
                }
                this.currentLocation = location.pathname;
            });
        }
        tweetInteractRetweetMenuQuote.addEventListener('click', async () => {
            if (!tweetReply.hidden) {
                tweetInteractReply.classList.remove('tweet-interact-reply-clicked');
                tweetReply.hidden = true;
            }
            tweetQuote.hidden = false;
            setTimeout(() => {
                tweetQuoteText.focus();
            })
        });
        let quoteMedia = [];
        tweetQuote.addEventListener('drop', e => {
            handleDrop(e, quoteMedia, tweetQuoteMedia);
        });
        tweetQuoteUpload.addEventListener('click', () => {
            getMedia(quoteMedia, tweetQuoteMedia);
        });
        tweetQuoteText.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.ctrlKey) {
                tweetQuoteButton.click();
            }
            tweetQuoteChar.innerText = `${tweetQuoteText.value.length}/280`;
            if(tweetQuoteText.value.length > 265) {
                tweetQuoteChar.style.color = "#c26363";
            } else {
                tweetQuoteChar.style.color = "";
            }
        });
        tweetQuoteText.addEventListener('keyup', e => {
            tweetQuoteChar.innerText = `${tweetQuoteText.value.length}/280`;
            if(tweetQuoteText.value.length > 265) {
                tweetQuoteChar.style.color = "#c26363";
            } else {
                tweetQuoteChar.style.color = "";
            }
        });
        tweetQuoteButton.addEventListener('click', async () => {
            let text = tweetQuoteText.value;
            tweetQuoteError.innerHTML = '';
            if (text.length === 0 && quoteMedia.length === 0) return;
            tweetQuoteButton.disabled = true;
            let uploadedMedia = [];
            for (let i in quoteMedia) {
                let media = quoteMedia[i];
                try {
                    media.div.getElementsByClassName('new-tweet-media-img-progress')[0].hidden = false;
                    let mediaId = await API.uploadMedia({
                        media_type: media.type,
                        media_category: media.category,
                        media: media.data,
                        alt: media.alt,
                        loadCallback: data => {
                            media.div.getElementsByClassName('new-tweet-media-img-progress')[0].innerText = `${data.text} (${data.progress}%)`;
                        }
                    });
                    uploadedMedia.push(mediaId);
                } catch (e) {
                    media.div.getElementsByClassName('new-tweet-media-img-progress')[0].hidden = true;
                    console.error(e);
                    alert(e);
                }
            }
            let tweetObject = {
                status: text,
                attachment_url: `https://twitter.com/${t.user.screen_name}/status/${t.id_str}`,
                auto_populate_reply_metadata: true,
                batch_mode: 'off',
                exclude_reply_user_ids: '',
                cards_platform: 'Web-13',
                include_entities: 1,
                include_user_entities: 1,
                include_cards: 1,
                send_error_codes: 1,
                tweet_mode: 'extended',
                include_ext_alt_text: true,
                include_reply_count: true
            };
            if (uploadedMedia.length > 0) {
                tweetObject.media_ids = uploadedMedia.join(',');
            }
            let tweetData;
            try {
                tweetData = await API.postTweet(tweetObject)
            } catch (e) {
                tweetQuoteError.innerHTML = (e && e.message ? e.message : e) + "<br>";
                tweetQuoteButton.disabled = false;
                return;
            }
            if (!tweetData) {
                tweetQuoteError.innerHTML = "Error sending tweet<br>";
                tweetQuoteButton.disabled = false;
                return;
            }
            tweetQuoteText.value = '';
            tweetQuote.hidden = true;
            tweetData._ARTIFICIAL = true;
            quoteMedia = [];
            tweetQuoteButton.disabled = false;
            tweetQuoteMedia.innerHTML = '';
            this.appendTweet(tweetData, timelineContainer, { prepend: true });
        });
    
        // Favorite
        tweetInteractFavorite.addEventListener('click', () => {
            if (t.favorited) {
                API.unfavoriteTweet({
                    id: t.id_str
                });
                t.favorited = false;
                t.favorite_count--;
                if(!options.mainTweet) {
                    tweetInteractFavorite.dataset.val = parseInt(tweetInteractFavorite.innerText) - 1;
                    tweetInteractFavorite.innerText = parseInt(tweetInteractFavorite.innerText) - 1;
                } else {
                    if(this.mainTweetLikers.find(liker => liker.id_str === user.id_str)) {
                        this.mainTweetLikers.splice(this.mainTweetLikers.findIndex(liker => liker.id_str === user.id_str), 1);
                        let likerImg = footerFavorites.querySelector(`a[data-id="${user.id_str}"]`);
                        if(likerImg) likerImg.remove()
                    }
                    tweetFooterFavorites.innerText = Number(parseInt(tweetFooterFavorites.innerText.replace(/\s/g, '').replace(/,/g, '').replace(/\./g, '')) - 1).toLocaleString().replace(/\s/g, ',');
                }
                tweetInteractFavorite.classList.remove('tweet-interact-favorited');
            } else {
                API.favoriteTweet({
                    id: t.id_str
                });
                t.favorited = true;
                t.favorite_count++;
                if(!options.mainTweet) {
                    tweetInteractFavorite.dataset.val = parseInt(tweetInteractFavorite.innerText) + 1;
                    tweetInteractFavorite.innerText = parseInt(tweetInteractFavorite.innerText) + 1;
                } else {
                    if(footerFavorites.children.length < 8 && !this.mainTweetLikers.find(liker => liker.id_str === user.id_str)) {
                        let a = document.createElement('a');
                        a.href = `https://twitter.com/${user.screen_name}`;
                        let likerImg = document.createElement('img');
                        likerImg.src = user.profile_image_url_https;
                        likerImg.classList.add('tweet-footer-favorites-img');
                        likerImg.title = user.name + ' (@' + user.screen_name + ')';
                        likerImg.width = 24;
                        likerImg.height = 24;
                        a.dataset.id = user.id_str;
                        a.appendChild(likerImg);
                        footerFavorites.appendChild(a);
                        this.mainTweetLikers.push(user);
                    }
                    tweetFooterFavorites.innerText = Number(parseInt(tweetFooterFavorites.innerText.replace(/\s/g, '').replace(/,/g, '').replace(/\./g, '')) + 1).toLocaleString().replace(/\s/g, ',');
                }
                tweetInteractFavorite.classList.add('tweet-interact-favorited');
            }
        });
    
        // More
        let moreClicked = false;
        tweetInteractMore.addEventListener('click', () => {
            if (tweetInteractMoreMenu.hidden) {
                tweetInteractMoreMenu.hidden = false;
            }
            if(moreClicked) return;
            moreClicked = true;
            setTimeout(() => {
                document.body.addEventListener('click', () => {
                    moreClicked = false;
                    setTimeout(() => tweetInteractMoreMenu.hidden = true, 50);
                }, { once: true });
            }, 50);
        });
        if(tweetInteractMoreMenuFollow) tweetInteractMoreMenuFollow.addEventListener('click', async () => {
            if (t.user.following) {
                await API.unfollowUser(t.user.screen_name);
                t.user.following = false;
                tweetInteractMoreMenuFollow.innerText = `Follow @${t.user.screen_name}`;
            } else {
                await API.followUser(t.user.screen_name);
                t.user.following = true;
                tweetInteractMoreMenuFollow.innerText = `Unfollow @${t.user.screen_name}`;
            }
        });
        tweetInteractMoreMenuCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(`https://twitter.com/${t.user.screen_name}/status/${t.id_str}`);
        });
        tweetInteractMoreMenuShare.addEventListener('click', () => {
            navigator.share({ url: `https://twitter.com/${t.user.screen_name}/status/${t.id_str}` });
        });
        tweetInteractMoreMenuEmbed.addEventListener('click', () => {
            openInNewTab(`https://publish.twitter.com/?query=https://twitter.com/${t.user.screen_name}/status/${t.id_str}&widget=Tweet`);
        });
        if (t.user.id_str === user.id_str) {
            tweetInteractMoreMenuAnalytics.addEventListener('click', () => {
                openInNewTab(`https://mobile.twitter.com/dimdenEFF/status/${t.id_str}/analytics`);
            });
            tweetInteractMoreMenuDelete.addEventListener('click', async () => {
                let sure = confirm("Are you sure you want to delete this tweet?");
                if (!sure) return;
                try {
                    await API.deleteTweet(t.id_str);
                } catch (e) {
                    alert(e);
                    console.error(e);
                    return;
                }
                Array.from(document.getElementsByClassName('timeline')[0].getElementsByClassName(`tweet-id-${t.id_str}`)).forEach(tweet => {
                    tweet.remove();
                });
                if(options.mainTweet) {
                    let tweets = Array.from(timelineContainer.getElementsByClassName('tweet'));
                    if(tweets.length === 0) {
                        document.getElementsByClassName('modal-close')[0].click();
                    } else {
                        tweets[0].click();
                    }
                }
                if(options.after) {
                    if(options.after.getElementsByClassName('tweet-self-thread-div')[0]) options.after.getElementsByClassName('tweet-self-thread-div')[0].hidden = true;
                    if(!options.after.classList.contains('tweet-main')) options.after.getElementsByClassName('tweet-interact-reply')[0].innerText = (+options.after.getElementsByClassName('tweet-interact-reply')[0].innerText - 1).toString();
                    else options.after.getElementsByClassName('tweet-footer-stat-replies')[0].innerText = (+options.after.getElementsByClassName('tweet-footer-stat-replies')[0].innerText - 1).toString();
                }
            });
        }
        tweetInteractMoreMenuRefresh.addEventListener('click', async () => {
            let tweetData;
            try {
                tweetData = await API.getTweet(t.id_str);
            } catch (e) {
                console.error(e);
                return;
            }
            if (!tweetData) {
                return;
            }
            if (tweetInteractFavorite.className.includes('tweet-interact-favorited') && !tweetData.favorited) {
                tweetInteractFavorite.classList.remove('tweet-interact-favorited');
            }
            if (tweetInteractRetweet.className.includes('tweet-interact-retweeted') && !tweetData.retweeted) {
                tweetInteractRetweet.classList.remove('tweet-interact-retweeted');
            }
            if (!tweetInteractFavorite.className.includes('tweet-interact-favorited') && tweetData.favorited) {
                tweetInteractFavorite.classList.add('tweet-interact-favorited');
            }
            if (!tweetInteractRetweet.className.includes('tweet-interact-retweeted') && tweetData.retweeted) {
                tweetInteractRetweet.classList.add('tweet-interact-retweeted');
            }
            if(!options.mainTweet) {
                tweetInteractFavorite.innerText = tweetData.favorite_count;
                tweetInteractRetweet.innerText = tweetData.retweet_count;
                tweetInteractReply.innerText = tweetData.reply_count;
            }
        });
        let downloading = false;
        if (t.extended_entities && t.extended_entities.media.length === 1) {
            tweetInteractMoreMenuDownload.addEventListener('click', () => {
                if (downloading) return;
                downloading = true;
                let media = t.extended_entities.media[0];
                let url = media.type === 'photo' ? media.media_url_https : media.video_info.variants[0].url;
                fetch(url).then(res => res.blob()).then(blob => {
                    downloading = false;
                    let a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = media.type === 'photo' ? media.media_url_https.split('/').pop() : media.video_info.variants[0].url.split('/').pop();
                    a.download = a.download.split('?')[0];
                    a.click();
                    a.remove();
                }).catch(e => {
                    downloading = false;
                    console.error(e);
                });
            });
            if (t.extended_entities.media[0].type === 'animated_gif') {
                tweetInteractMoreMenuDownloadGif.addEventListener('click', () => {
                    if (downloading) return;
                    downloading = true;
                    let video = tweet.getElementsByClassName('tweet-media-element')[0];
                    let canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    let ctx = canvas.getContext('2d');
                    if (video.duration > 10 && !confirm('This video is longer than 10 seconds. Are you sure you want to convert it, might lag')) {
                        return downloading = false;
                    }
                    let gif = new GIF({
                        workers: 2,
                        quality: 10
                    });
                    video.currentTime = 0;
                    video.loop = false;
                    let isFirst = true;
                    let interval = setInterval(async () => {
                        if(isFirst) {
                            video.currentTime = 0;
                            isFirst = false;
                            await sleep(5);
                        }
                        if (video.currentTime+0.1 >= video.duration) {
                            clearInterval(interval);
                            gif.on('finished', blob => {
                                let a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = `${t.id_str}.gif`;
                                document.body.append(a);
                                a.click();
                                a.remove();
                                downloading = false;
                                video.loop = true;
                                video.play();
                            });
                            gif.render();
                            return;
                        }
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        gif.addFrame(imgData, { delay: 100 });
                    }, 100);
                });
            }
        }
    
        if(options.after) {
            options.after.after(tweet);
        } else if (options.prepend) {
            timelineContainer.prepend(tweet);
        } else {
            timelineContainer.append(tweet);
        }
        twemoji.parse(tweet);
        return tweet;
    }
    async popstateChange(that) {
        that.savePageData(that.currentLocation);
        that.updateSubpage();
        that.mediaToUpload = [];
        that.linkColors = {};
        that.cursor = undefined;
        that.seenReplies = [];
        that.mainTweetLikers = [];
        let id;
        try {
            id = location.pathname.match(/status\/(\d{1,32})/)[1];
        } catch(e) {
            return that.container.getElementsByClassName('modal-close')[0].click();
        }
        let restored = await that.restorePageData();
        if(that.subpage === 'tweet' && !restored) {
            that.updateReplies(id);
        } else if(that.subpage === 'likes') {
            that.updateLikes(id);
        } else if(that.subpage === 'retweets') {
            that.updateRetweets(id);
        } else if(that.subpage === 'retweets_with_comments') {
            that.updateRetweetsWithComments(id);
        }
        that.currentLocation = location.pathname;
    }
    async appendTombstone(timelineContainer, text) {
        this.tweets.push(['tombstone', text]);
        let tombstone = document.createElement('div');
        tombstone.className = 'tweet-tombstone';
        tombstone.innerText = text;
        timelineContainer.append(tombstone);
    }
    init() {
        document.getElementsByClassName('timeline-more')[0].addEventListener('click', async () => {
            if (!this.cursor || this.loadingNewTweets) return;
            this.loadingNewTweets = true;
            let path = location.pathname;
            if(path.endsWith('/')) path = path.slice(0, -1);
            this.updateReplies(path.split('/').slice(-1)[0], this.cursor);
        });
        document.getElementsByClassName('likes-more')[0].addEventListener('click', async () => {
            if(!this.likeCursor) return;
            let id = location.pathname.match(/status\/(\d{1,32})/)[1];
            this.updateLikes(id, this.likeCursor);
        });
        document.getElementsByClassName('retweets-more')[0].addEventListener('click', async () => {
            if(!this.retweetCursor) return;
            let id = location.pathname.match(/status\/(\d{1,32})/)[1];
            this.updateRetweets(id, this.retweetCursor);
        });
        document.getElementsByClassName('retweets_with_comments-more')[0].addEventListener('click', async () => {
            if(!this.retweetCommentsCursor) return;
            let id = location.pathname.match(/status\/(\d{1,32})/)[1];
            this.updateRetweetsWithComments(id, this.retweetCommentsCursor);
        });

        this.updateSubpage();
        let id = location.pathname.match(/status\/(\d{1,32})/)[1];
        if(this.subpage === 'tweet') {
            this.updateReplies(id);
        } else if(this.subpage === 'likes') {
            this.updateLikes(id);
        } else if(this.subpage === 'retweets') {
            this.updateRetweets(id);
        } else if(this.subpage === 'retweets_with_comments') {
            this.updateRetweetsWithComments(id);
        }
        this.popstateHelper = () => this.popstateChange(this);
        window.addEventListener("popstate", this.popstateHelper);
    }
    close() {
        document.removeEventListener('scroll', this.onscroll);
        window.removeEventListener("popstate", this.popstateHelper);
    }
}