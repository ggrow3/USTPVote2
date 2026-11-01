import { NotFoundException, type PipeTransform } from '@nestjs/common';
import { isCourseId } from 'ustp-domain';

/** A course ID from the address; anything else names no course, and never reaches the database as a path. */
export class CourseIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isCourseId(value)) throw new NotFoundException('course not found');
    return value;
  }
}
