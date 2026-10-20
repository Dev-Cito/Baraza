import { Comment } from '../comments/comment.entity';
import { CommentsService } from '../comments/comments.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoadersService } from './loaders.service';

const user = (id: string) => ({ id, username: id }) as User;
const comment = (id: string, postId: string) => ({ id, postId }) as Comment;

describe('LoadersService', () => {
  let usersService: { findByIds: jest.Mock };
  let commentsService: { findByPostIds: jest.Mock; countByPostIds: jest.Mock };
  let service: LoadersService;

  beforeEach(() => {
    usersService = { findByIds: jest.fn() };
    commentsService = { findByPostIds: jest.fn(), countByPostIds: jest.fn() };
    service = new LoadersService(
      usersService as unknown as UsersService,
      commentsService as unknown as CommentsService,
    );
  });

  it('usersById batches into one call and aligns results with requested ids', async () => {
    // The database returns rows in arbitrary order and omits unknown ids.
    usersService.findByIds.mockResolvedValue([user('b'), user('a')]);
    const { usersById } = service.create();

    const result = await Promise.all([
      usersById.load('a'),
      usersById.load('missing'),
      usersById.load('b'),
    ]);

    expect(usersService.findByIds).toHaveBeenCalledTimes(1);
    expect(usersService.findByIds).toHaveBeenCalledWith(['a', 'missing', 'b']);
    expect(result.map((u) => u?.id ?? null)).toEqual(['a', null, 'b']);
  });

  it('commentsByPostId groups comments per post, [] when none', async () => {
    commentsService.findByPostIds.mockResolvedValue([
      comment('c1', 'p2'),
      comment('c2', 'p1'),
      comment('c3', 'p2'),
    ]);
    const { commentsByPostId } = service.create();

    const result = await commentsByPostId.loadMany(['p1', 'p2', 'p3']);

    expect(commentsService.findByPostIds).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      [comment('c2', 'p1')],
      [comment('c1', 'p2'), comment('c3', 'p2')],
      [],
    ]);
  });

  it('commentCountByPostId aligns counts, 0 when absent', async () => {
    commentsService.countByPostIds.mockResolvedValue([
      { postId: 'p2', count: 3 },
    ]);
    const { commentCountByPostId } = service.create();

    const result = await commentCountByPostId.loadMany(['p1', 'p2']);

    expect(commentsService.countByPostIds).toHaveBeenCalledTimes(1);
    expect(result).toEqual([0, 3]);
  });

  it('never shares loader instances or caches between create() calls', async () => {
    usersService.findByIds.mockResolvedValue([user('a')]);
    const first = service.create();
    const second = service.create();

    expect(second.usersById).not.toBe(first.usersById);
    expect(second.commentsByPostId).not.toBe(first.commentsByPostId);
    expect(second.commentCountByPostId).not.toBe(first.commentCountByPostId);

    await first.usersById.load('a');
    await first.usersById.load('a'); // cache hit within the same request
    expect(usersService.findByIds).toHaveBeenCalledTimes(1);

    await second.usersById.load('a'); // new request: must hit the database
    expect(usersService.findByIds).toHaveBeenCalledTimes(2);
  });
});
