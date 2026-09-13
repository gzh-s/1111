import {
    Context, db, DocumentModel, Filter, ForbiddenError, Handler, MessageModel, NotFoundError, NumberKeys, ObjectId, OplogModel, param, PERM, PermissionError, PRIV, SettingModel, Types, UserModel,
    UserNotFoundError,
    ValidationError,
} from 'hydrooj';
import { escapeRegExp } from 'lodash';

export const TYPE_TICKET = 800 as const;
export const TYPE_TICKET_POST = 801 as const;

export enum TicketStatus {
    OPEN = 1, // 待处理
    PROCESSING = 2, // 处理中
    WAITING_FOR_USER = 3, // 已回复/待补充
    SUSPENDED = 4, // 挂起
    RESOLVED = 5, // 已解决
    CLOSED = 6, // 已关闭
}
export enum TicketSystemOperation {
    ASSIGNED = 'assigned',
    STATUS_CHANGED = 'status_changed',
    TITLE_CHANGED = 'title_changed',
    CATEGORY_CHANGED = 'category_changed',
    TICKET_CHANGED = 'ticket_changed',
    TICKET_CLOSED = 'ticket_closed',
    TICKET_REOPENED = 'ticket_reopened',
}

export const TicketCategory = [
    'General', 'ProblemTopic', 'Suggestion', 'Report', 'Account',
] as const;

export interface TicketDoc {
    _id?: ObjectId;
    domainId: string;
    owner: number;
    assignee?: number;
    title: string;
    status: TicketStatus;
    category?: string;
    updateAt: Date;
    content: string;
    ip: string;
    nReply: number;
}

export interface TicketSystemPostData {
    operation: TicketSystemOperation;
    operator: number;
    target?: number;
    data?: any;
}


export interface TicketPostDoc {
    _id?: ObjectId;
    tid: ObjectId;
    owner: number;
    content: string | TicketSystemPostData;
    ip: string;
    isSystem?: boolean;
    target?: number;
}

declare module 'hydrooj' {
    interface DocType {
        [TYPE_TICKET]: TicketDoc;
        [TYPE_TICKET_POST]: TicketPostDoc;
    }

    interface Collections {
        ticket: TicketDoc;
        ticket_post: TicketPostDoc;
    }

    interface Model {
        ticket: typeof TicketModel;
    }
}

export class TicketModel {
    static async add(
        domainId: string, owner: number, title: string, category: string, content: string, ip?: string,
    ): Promise<ObjectId> {
        const payload: Partial<TicketDoc> = {
            content,
            owner,
            title,
            category,
            ip,
            status: TicketStatus.OPEN,
            nReply: 0,
            updateAt: new Date(),
        };
        const res = await DocumentModel.add(
            domainId, payload.content!, payload.owner!, TYPE_TICKET,
            null, null, null, payload,
        );
        return res;
    }

    static async get(domainId: string, tid: ObjectId): Promise<TicketDoc> {
        const doc = await DocumentModel.get(domainId, TYPE_TICKET, tid);
        if (!doc) throw new NotFoundError(domainId, tid);
        return doc;
    }

    static async edit(domainId: string, tid: ObjectId, $set: Partial<TicketDoc>): Promise<TicketDoc> {
        $set.updateAt ||= new Date();
        return await DocumentModel.set(domainId, TYPE_TICKET, tid, $set);
    }

    static inc(domainId: string, tid: ObjectId, key: NumberKeys<TicketDoc>, value: number): Promise<TicketDoc | null> {
        return DocumentModel.inc(domainId, TYPE_TICKET, tid, key, value);
    }

    static async del(domainId: string, tid: ObjectId): Promise<void> {
        await Promise.all([
            DocumentModel.deleteOne(domainId, TYPE_TICKET, tid),
            DocumentModel.deleteMultiStatus(domainId, TYPE_TICKET, { docId: tid }),
            DocumentModel.deleteMulti(domainId, TYPE_TICKET_POST, {
                parentType: TYPE_TICKET, parentId: tid
            }),
        ]);
    }

    static count(domainId: string, query: Filter<TicketDoc>) {
        return DocumentModel.count(domainId, TYPE_TICKET, query);
    }

    static getMulti(domainId: string, query: Filter<TicketDoc> = {}) {
        return DocumentModel.getMulti(domainId, TYPE_TICKET, query)
            .sort({ updateAt: -1 });
    }

    static async addPost(domainId: string, tid: ObjectId, owner: number, content: string, ip: string): Promise<ObjectId> {
        const [postId] = await Promise.all([
            DocumentModel.add(
                domainId, content, owner, TYPE_TICKET_POST,
                null, TYPE_TICKET, tid, { ip, isSystem: false },
            ),
            DocumentModel.incAndSet(domainId, TYPE_TICKET, tid, 'nReply', 1, { updateAt: new Date() }),
        ]);
        return postId;
    }

    static async addSystemPost(
        domainId: string,
        tid: ObjectId,
        operator: number,
        operation: TicketSystemOperation,
        targetUid?: number,
        data?: any
    ): Promise<ObjectId> {
        const content = JSON.stringify({ operation, target: targetUid, data, operator });
        const [postId] = await Promise.all([
            DocumentModel.add(
                domainId, content, 1, TYPE_TICKET_POST,
                null, TYPE_TICKET, tid, { isSystem: true, target: targetUid },
            ),
            DocumentModel.set(domainId, TYPE_TICKET, tid, { updateAt: new Date() }),
        ]);
        return postId;
    }

    static async getPost(domainId: string, postId: ObjectId): Promise<TicketPostDoc> {
        const doc = await DocumentModel.get(domainId, TYPE_TICKET_POST, postId);
        if (!doc) throw new NotFoundError(domainId, postId);
        return doc;
    }

    static getMultiPosts(domainId: string, tid: ObjectId) {
        return DocumentModel.getMulti(
            domainId, TYPE_TICKET_POST,
            { parentType: TYPE_TICKET, parentId: tid },
        ).sort({ _id: 1 });
    }

    static async editPost(domainId: string, postId: ObjectId, content: string): Promise<TicketPostDoc> {
        return await DocumentModel.set(domainId, TYPE_TICKET_POST, postId, { content });
    }

    static async delPost(domainId: string, postId: ObjectId) {
        const post = await TicketModel.getPost(domainId, postId);
        await Promise.all([
            DocumentModel.deleteOne(domainId, TYPE_TICKET_POST, postId),
            DocumentModel.inc(domainId, TYPE_TICKET, post.tid, 'nReply', -1),
        ]);
    }

    static async assign(domainId: string, tid: ObjectId, assignee: number): Promise<TicketDoc> {
        return await TicketModel.edit(domainId, tid, {
            assignee,
            status: TicketStatus.PROCESSING,
            updateAt: new Date(),
        });
    }

    static async setStatus(domainId: string, tid: ObjectId, status: TicketStatus): Promise<TicketDoc> {
        return await TicketModel.edit(domainId, tid, {
            status,
            updateAt: new Date(),
        });
    }
}

global.Hydro.model.ticket = TicketModel;

class TicketHandler extends Handler {
    tdoc?: TicketDoc;

    @param('tid', Types.ObjectId, true)
    async _prepare(domainId: string, tid: ObjectId) {
        if (tid) {
            this.tdoc = await TicketModel.get(domainId, tid);
            if (!this.tdoc) throw new NotFoundError(domainId, tid);
        }
    }
}

class TicketListHandler extends TicketHandler {
    @param('category', Types.Range(TicketCategory), true)
    @param('status', Types.Range(Object.values(TicketStatus)), true)
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(domainId: string, category = '', status: number = -1, page = 1, q = '') {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);

        const escaped = escapeRegExp(q.toLowerCase());
        const $regex = new RegExp(q.length >= 2 ? escaped : `\\A${escaped}`, 'gim');


        const filter: any = {};
        // root
        if (!this.user.hasPerm(PERM.PERM_EDIT_DOMAIN)) {
            filter.owner = this.user._id;
        }
        if (status !== -1) {
            filter.status = status;
        }
        if (q.length > 0) {
            filter.title = $regex;
        }
        if (category) {
            filter.category = category;
        }

        let qs = status ? `status=${status}` : '';
        if (category) qs += `${qs ? '&' : ''}category=${category}`;
        if (q) qs += `${qs ? '&' : ''}q=${encodeURIComponent(q)}`;

        const [tdocs, tpcount] = await this.paginate(
            TicketModel.getMulti(domainId, filter).sort({ updateAt: -1 }),
            page,
            this.ctx.setting.get('pagination.ticket') || 30,
        );

        const uids = new Set(
            tdocs.flatMap(tdoc => [tdoc.owner, tdoc.assignee].filter(Boolean))
        );
        const udict = await UserModel.getList(domainId, Array.from(uids));

        this.response.template = 'ticket_list.html';
        this.response.body = {
            tdocs, tpcount, page, udict, statusFilter: status, categoryFilter: category, TicketStatus, TicketCategory, qs, q,
        };
    }
}

class TicketEditHandler extends TicketHandler {
    async get() {
        if (this.tdoc && !this.user.own(this.tdoc!) && this.tdoc.assignee !== this.user._id) this.checkPerm(PERM.PERM_EDIT_DOMAIN);

        this.response.template = 'ticket_edit.html';
        this.response.body = { tdoc: this.tdoc, TicketCategory };
    }

    @param('category', Types.String)
    @param('title', Types.Title)
    @param('content', Types.Content)
    async postCreate(domainId: string, category: string, title: string, content: string) {
        if (!TicketCategory.includes(category as any)) throw new ValidationError('category');
        await this.limitRate('add_ticket', 3600, 60);
        const tid = await TicketModel.add(domainId, this.user._id, title, category, content, this.request.ip);
        this.response.body = { tid };
        this.response.redirect = this.url('ticket_detail', { domainId, uid: this.user._id, tid });
    }

    @param('tid', Types.ObjectId)
    @param('category', Types.String)
    @param('title', Types.Title)
    @param('content', Types.Content)
    async postUpdate(domainId: string, tid: ObjectId, category: string, title: string, content: string) {
        if (!this.user.own(this.tdoc!) && this.tdoc.assignee !== this.user._id) {
            this.checkPerm(PERM.PERM_EDIT_DOMAIN);
        }
        if (!TicketCategory.includes(category as any)) throw new ValidationError('category');

        const oldTitle = this.tdoc!.title;
        const oldCategory = this.tdoc!.category;

        await Promise.all([
            TicketModel.edit(domainId, tid, { title, content, category }),
            OplogModel.log(this, 'ticket.edit', this.tdoc),
        ]);

        await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.TICKET_CHANGED, this.tdoc.owner);
        if (oldTitle !== title) {
            await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.TITLE_CHANGED, this.tdoc.owner, { from: oldTitle, to: title });
        }
        if (oldCategory !== category) {
            await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.CATEGORY_CHANGED, this.tdoc.owner, { from: oldCategory, to: category });
        }

        this.response.body = { tid };
        this.response.redirect = this.url('ticket_detail', { domainId, uid: this.user._id, tid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); // need root
        await Promise.all([
            TicketModel.del(domainId, tid),
            OplogModel.log(this, 'ticket.delete', this.tdoc),
        ]);
        this.response.redirect = this.url('ticket_main', { domainId });
    }
}

class TicketDetailHandler extends TicketHandler {
    @param('tid', Types.ObjectId)
    async get(domainId: string, tid: ObjectId) {
        if (!this.user.own(this.tdoc!) && this.tdoc?.assignee !== this.user._id) this.checkPerm(PERM.PERM_EDIT_DOMAIN);

        const udoc = await UserModel.getById(domainId, this.tdoc!.owner);
        const tpdocs = await TicketModel.getMultiPosts(domainId, tid).toArray();

        const uids = new Set(tpdocs.map(({ owner }) => owner))
        if (this.tdoc.assignee) uids.add(this.tdoc.assignee);
        for (const tpdoc of tpdocs) {
            if (tpdoc.target) uids.add(tpdoc.target);
            if (!tpdoc.isSystem || !tpdoc.content) continue;
            // system post
            if (typeof tpdoc.content === 'string') {
                try {
                    const content = JSON.parse(tpdoc.content);
                    Object.assign(tpdoc, content);
                } catch (e) { }
            } else if (typeof tpdoc.content === 'object') {
                Object.assign(tpdoc, tpdoc.content);
            }
            // @ts-ignore
            if (tpdoc.operator) uids.add(tpdoc.operator);
        }
        const udict = await UserModel.getList(domainId, Array.from(uids));

        console.log(tpdocs);

        this.response.template = 'ticket_detail.html';
        this.response.body = {
            tdoc: this.tdoc, tpdocs, TicketStatus, udict, udoc
        };
        this.UiContext.extraTitleContent = this.tdoc.title;

    }

    async post() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    @param('tid', Types.ObjectId)
    @param('uidOrName', Types.UidOrName)
    async postAssign(domainId: string, tid: ObjectId, uidOrName: string) {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); // need root
        const udoc = await UserModel.getById(domainId, +uidOrName)
            || await UserModel.getByUname(domainId, uidOrName)
            || await UserModel.getByEmail(domainId, uidOrName);
        if (!udoc) throw new UserNotFoundError(uidOrName);

        await TicketModel.assign(domainId, tid, udoc._id);
        const link = `/d/${domainId}/ticket/${tid.toString()}`;
        const msg = JSON.stringify({
            message: `「系统通知」您被指派了工单 #${tid.toString()} "${this.tdoc.title}"。{0:link}`,
            params: [link],
        });
        await MessageModel.send(1, udoc._id, msg, MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD);
        await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.ASSIGNED, udoc._id);

        this.back();
    }

    @param('tid', Types.ObjectId)
    async postClaim(domainId: string, tid: ObjectId) {
        // domain root
        this.checkPerm(PERM.PERM_EDIT_DOMAIN);
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && this.tdoc.assignee) {
            throw new ForbiddenError('工单已被认领，仅允许超管重新指派责任人。');
        }

        await TicketModel.assign(domainId, tid, this.user._id);

        const link = `/d/${domainId}/ticket/${tid.toString()}`;
        const msg = JSON.stringify({
            message: `「系统通知」您的工单 #${tid.toString()} 已被 {0} 认领。{1:link}`,
            params: [this.user.uname, link],
        });

        if (this.tdoc.owner !== this.user._id) {
            await MessageModel.send(1, this.tdoc.owner, msg, MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD);
        }

        await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.ASSIGNED, this.user._id);

        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('status', Types.Range(Object.values(TicketStatus)))
    async postSetStatus(domainId: string, tid: ObjectId, status: number) {
        if (!this.user.hasPerm(PERM.PERM_EDIT_DOMAIN) && this.tdoc.assignee !== this.user._id) {
            if (this.user.own(this.tdoc!) && (status === TicketStatus.CLOSED || status === TicketStatus.RESOLVED)) {
                // ok
            } else {
                this.checkPerm(PERM.PERM_EDIT_DOMAIN);
            }
        }

        await TicketModel.setStatus(domainId, tid, status);
        if (status === TicketStatus.CLOSED) {
            await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.TICKET_CLOSED, undefined, {
                from: this.tdoc.status,
                to: status
            });
        } else if (this.tdoc.status === TicketStatus.CLOSED && status === TicketStatus.PROCESSING) {
            await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.TICKET_REOPENED, undefined, {
                from: this.tdoc.status,
                to: status
            });
        } else {
            await TicketModel.addSystemPost(domainId, tid, this.user._id, TicketSystemOperation.STATUS_CHANGED, undefined, {
                from: this.tdoc.status,
                to: status
            });
        }
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('content', Types.Content)
    async postReply(domainId: string, tid: ObjectId, content: string) {
        const tdoc = this.tdoc;
        await this.limitRate('add_ticket', 3600, 60);
        const targets = new Set(Array.from(content.matchAll(/@\[\]\(\/user\/(\d+)\)/g)).map((i) => +i[1]));
        const uids = Object.keys(await UserModel.getList(domainId, Array.from(targets))).map((i) => +i);
        const msg = JSON.stringify({
            message: 'User {0} mentioned you in ticket {1:link}',
            params: [this.user.uname, `/d/${domainId}${this.request.path}`],
        });
        await Promise.all(uids.map((i) => MessageModel.send(1, i, msg, MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD)));
        const tpid = await TicketModel.addPost(domainId, tid, this.user._id, content, this.request.ip);

        if (this.tdoc.owner === this.user._id) {
            // User replied, change status to OPEN if it was WAITING_FOR_USER or RESOLVED
            if (this.tdoc.status === TicketStatus.WAITING_FOR_USER || this.tdoc.status === TicketStatus.RESOLVED) {
                await TicketModel.setStatus(domainId, tid, TicketStatus.OPEN);
            }
        } else if (this.tdoc.assignee === this.user._id) {
            // Assignee replied, set to WAITING_FOR_USER
            if (this.tdoc.status === TicketStatus.OPEN) {
                await TicketModel.setStatus(domainId, tid, TicketStatus.WAITING_FOR_USER);
            }
        }

        const target = (this.user._id === this.tdoc.owner) ? this.tdoc.assignee : this.tdoc.owner;
        const link = `/d/${domainId}/ticket/${tid.toString()}`;

        if (target && target !== this.user._id && this.tdoc.status !== TicketStatus.CLOSED) {
            await MessageModel.send(1, target, JSON.stringify({
                message: `「系统通知」您的工单 #${tid.toString()} 有新回复。{0:link}`,
                params: [link],
            }), MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD);
        }

        this.back({ tpid });
    }

    @param('tpid', Types.ObjectId)
    @param('content', Types.Content)
    async postEditReply(domainId: string, tpid: ObjectId, content: string) {
        const tpdoc = await TicketModel.getPost(domainId, tpid);
        if (!this.user.own(tpdoc)) {
            this.checkPerm(PERM.PERM_EDIT_DOMAIN);
        }
        await TicketModel.editPost(domainId, tpid, content);
        this.back();
    }

    @param('tid', Types.ObjectId)
    @param('tpid', Types.ObjectId)
    async postDeleteReply(domainId: string, tid: ObjectId, tpid: ObjectId) {
        const tpdoc = await TicketModel.getPost(domainId, tpid);
        const tdoc = this.tdoc;
        const deleteBy = tpdoc.owner === this.user._id ? 'Self' : tdoc.owner === this.user._id ? 'Ticket Owner' : 'Admin';
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); // need root
        await TicketModel.delPost(domainId, tpid);

        if (!tpdoc.isSystem) {
            const msg = JSON.stringify({
                message: '{0} {1} delete your ticket post {2} in "{3}"({4:link}).',
                params: [
                    deleteBy,
                    this.user.uname,
                    (tpdoc.content as string).length > 10 ? `${(tpdoc.content as string).substring(0, 10)}...` : tpdoc.content,
                    tdoc.title,
                    `/d/${domainId}${this.request.path}`,
                ],
            });

            if (deleteBy !== 'Self') {
                await MessageModel.send(1, tpdoc.owner, msg, MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD);
            }
        }
        this.back();
    }
}

export async function apply(ctx: Context) {
    ctx.Route('ticket_main', '/ticket', TicketListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('ticket_create', '/ticket/create', TicketEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('ticket_edit', '/ticket/:tid/edit', TicketEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('ticket_detail', '/ticket/:tid', TicketDetailHandler, PRIV.PRIV_USER_PROFILE);

    ctx.inject(['setting'], (c) => {
        c.setting.SystemSetting(
            SettingModel.Setting('setting_limit', 'pagination.ticket', 20, 'number', 'pagination.ticket', 'Ticket per page'),
        );
    });

    ctx.i18n.load('zh', {
        Ticket: '工单',
        ticket_list: '工单列表',
        ticket_create: '创建工单',
        ticket_edit: '修改工单',
        ticket_detail: '工单详情',
    });
    ctx.i18n.load('en', {
        Ticket: 'Ticket',
        ticket_list: 'Ticket List',
        ticket_create: 'Create Ticket',
        ticket_edit: 'Edit Ticket',
        ticket_detail: 'Ticket Detail',
    });

    ctx.injectUI('UserDropdown', 'ticket_main', (h: any) => ({ icon: 'help', displayName: 'Ticket' }), PRIV.PRIV_USER_PROFILE);
}